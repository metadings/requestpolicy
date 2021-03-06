/*
 * ***** BEGIN LICENSE BLOCK *****
 *
 * RequestPolicy - A Firefox extension for control over cross-site requests.
 * Copyright (c) 2008-2012 Justin Samuel
 * Copyright (c) 2014-2015 Martin Kimmerle
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option) any later
 * version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program. If not, see <http://www.gnu.org/licenses/>.
 *
 * ***** END LICENSE BLOCK *****
 */

/* global Components */
const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

/* exported UserSubscriptions, SubscriptionList,
       Subscription, SUBSCRIPTION_UPDATED_TOPIC, SUBSCRIPTION_ADDED_TOPIC,
       SUBSCRIPTION_REMOVED_TOPIC */
this.EXPORTED_SYMBOLS = [
  "UserSubscriptions",
  "SubscriptionList",
  "Subscription",
  "SUBSCRIPTION_UPDATED_TOPIC",
  "SUBSCRIPTION_ADDED_TOPIC",
  "SUBSCRIPTION_REMOVED_TOPIC"
];

let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});

let {ScriptLoader: {importModule}} = Cu.import(
    "chrome://rpcontinued/content/lib/script-loader.jsm", {});
let {Logger} = importModule("lib/logger");
let {RawRuleset} = importModule("lib/ruleset");
let {FileUtil} = importModule("lib/utils/files");
let {RulesetStorage} = importModule("lib/ruleset-storage");

//==============================================================================
// Constants
//==============================================================================

const SUBSCRIPTION_UPDATED_TOPIC = "rpcontinued-subscription-policy-updated";
const SUBSCRIPTION_ADDED_TOPIC = "rpcontinued-subscription-policy-added";
const SUBSCRIPTION_REMOVED_TOPIC = "rpcontinued-subscription-policy-removed";

const DEFAULT_SUBSCRIPTION_LIST_URL_BASE =
    "https://raw.githubusercontent.com/" +
    "RequestPolicyContinued/subscriptions/master/";

const SUBSCRIPTION_UPDATE_SUCCESS = "SUCCESS";
const SUBSCRIPTION_UPDATE_NOT_NEEDED = "NOT_NEEDED";
const SUBSCRIPTION_UPDATE_FAILURE = "FAILURE";

//==============================================================================
// utilities
//==============================================================================

function setTimeout(func, delay) {
  var timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  var event = {
    notify: () => func()
  };
  timer.initWithCallback(event, delay, Ci.nsITimer.TYPE_ONE_SHOT);
  return timer;
}

function dprint(msg) {
  Logger.info(Logger.TYPE_INTERNAL, msg);
}

//==============================================================================
// UserSubscriptions
//==============================================================================

/**
 * Represents all of the subscriptions a user has enabled. This is where user
 * subscription information is stored and provides the mechanism for updating
 * subscriptions.
 */
function UserSubscriptions() {
  var userSubsFile = FileUtil.getRPUserDir();
  userSubsFile.appendRelativePath("subscriptions.json");
  let jsonData = "{}";
  if (userSubsFile.exists()) {
    jsonData = FileUtil.fileToString(userSubsFile);
  }
  this._data = JSON.parse(jsonData);
  if (!this._data.lists) {
    this._data.lists = {
      "official": {
        "subscriptions": {
          "allow_embedded": {},
          "allow_extensions": {},
          "allow_functionality": {},
          "allow_mozilla": {},
          "allow_sameorg": {},
          "deny_trackers": {}
        }
      }
    };
  }
  this._lists = this._data.lists;
}

UserSubscriptions.prototype = {
  toString: function() {
    return "[UserSubscriptions]";
  },

  save: function() {
    var userSubsFile = FileUtil.getRPUserDir();
    userSubsFile.appendRelativePath("subscriptions.json");
    FileUtil.stringToFile(JSON.stringify(this._data), userSubsFile);
  },

  getSubscriptionInfo: function() {
    var lists = this._data.lists;
    var result = {};
    for (var listName in lists) {
      if (!lists[listName].subscriptions) {
        continue;
      }
      result[listName] = {};
      for (let subName in lists[listName].subscriptions) {
        result[listName][subName] = null;
      }
    }
    return result;
  },

  addSubscription: function(listName, subName) {
    var lists = this._data.lists;
    if (!lists[listName]) {
      lists[listName] = {};
    }
    if (!lists[listName].subscriptions) {
      lists[listName].subscriptions = {};
    }
    lists[listName].subscriptions[subName] = {};
    this.save();
  },

  removeSubscription: function(listName, subName) {
    var lists = this._data.lists;
    if (lists[listName] && lists[listName].subscriptions &&
        lists[listName].subscriptions[subName]) {
      delete lists[listName].subscriptions[subName];
    }
    this.save();
  },

  // This method kinda sucks. Maybe move this to a worker and write this
  // procedurally instead of event-driven. That is, the async requests really
  // make a big fat mess of the code, or more likely I'm just not good at
  // making it not a mess. On the other hand, this parallelizes the update
  // requests, though that may not be a great thing in this case.
  update: function(callback, serials) {
    var updatingLists = {};
    var updateResults = {};

    function recordDone(listName, subName, result) {
      dprint("Recording done: " + listName + " " + subName);
      if (subName) {
        updateResults[listName][subName] = result;
        let list = updatingLists[listName];
        delete list[subName];
        for (let i in list) { // jshint ignore:line
          return; // What's that??
        }
      }
      delete updatingLists[listName];
      for (let i in updatingLists) { // jshint ignore:line
        return; // What's that??
      }
      setTimeout(() => callback(updateResults), 0);
    }

    var listCount = 0;
    /* jshint -W083 */ // Don't make functions within a loop.
    for (var listName in serials) {
      if (!this._lists[listName] || !this._lists[listName].subscriptions) {
        dprint("Skipping update of unsubscribed list: " + listName);
        continue;
      }
      let updateSubs = {};
      var subCount = 0;
      for (let subName in serials[listName]) {
        if (!this._lists[listName].subscriptions[subName]) {
          dprint("Skipping update of unsubscribed subscription: " + listName +
              " " + subName);
          continue;
        }
        updateSubs[subName] = {"serial": serials[listName][subName]};
        subCount++;
      }
      if (subCount === 0) {
        dprint("Skipping list with no subscriptions: " + listName);
        continue;
      }
      var url = this._lists[listName].url;
      if (!url) {
        url = DEFAULT_SUBSCRIPTION_LIST_URL_BASE + listName + ".json";
      }
      if (!url) {
        dprint("Skipping list without url: " + listName);
        continue;
      }
      var list = new SubscriptionList(listName, url);
      updatingLists[listName] = {};
      for (let subName in updateSubs) {
        dprint("Will update subscription: " + listName + " " + subName);
        updatingLists[listName][subName] = true;
      }
      updateResults[listName] = {};

      let metadataSuccess = function(list) {
        function subSuccess(sub, status) {
          dprint("Successfully updated subscription " + sub.toString());
          recordDone(list._name, sub._name, status);
        }

        function subError(sub, error) {
          dprint("Failed to update subscription " + sub.toString() + ": " +
                error);
          recordDone(list._name, sub._name, SUBSCRIPTION_UPDATE_FAILURE);
        }

        dprint("Successfully updated list " + list.toString());
        list.updateSubscriptions(updateSubs, subSuccess, subError);
      };

      let metadataError = function(list, error) {
        dprint("Failed to update list: " + list.toString() + ": " + error);
        updateResults[listName] = false;
        recordDone(list._name);
      };

      listCount++;
      dprint("Will update list: " + listName);
      list.updateMetadata(metadataSuccess, metadataError);
    }
    /* jshint +W083 */ // Don't make functions within a loop.

    if (listCount === 0) {
      dprint("No lists to update.");
      setTimeout(() => callback(updateResults), 0);
    }
  }
};

//==============================================================================
// SubscriptionList
//==============================================================================

/**
 * Represents a list of available subscriptions. Any actual subscription belongs
 * to a list. Each list has a unique name and within each list every
 * subscription has a unique name. The available subscriptions in the list is
 * determined by downloading a metadata file which specifies the subscription
 * names, the url for each subscription, and the subscription's current serial
 * number. If the the user's current copy of a subscription policy has a serial
 * number that is not lower than the one listed, an update isn't necessary.
 *
 * @param {string} name
 * @param {string} url
 */
function SubscriptionList(name, url) {
  // TODO: allow only ascii lower letters, digits, and hyphens in name.
  this._name = name;
  this._url = url;
}

SubscriptionList.prototype = {
  _name: null,
  _url: null,
  _data: null,

  toString: function() {
    return "[SubscriptionList " + this._name + " " + this._url + "]";
  },

  updateMetadata: function(successCallback, errorCallback) {
    dprint("Updating " + this.toString());
    var req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
      .createInstance(Components.interfaces.nsIXMLHttpRequest);
    var self = this;
    req.onload = function(event) {
      try {
        self._data = JSON.parse(req.responseText);
        // Maybe we don't need to write this to a file since we never read it
        // back again (we always grab new metadata when updating).
        setTimeout(() => successCallback(self), 0);
      } catch (e) {
        setTimeout(() => errorCallback(self, e.toString()), 0);
      }
    };
    req.onerror = function(event) {
      setTimeout(() => errorCallback(self, req.statusText), 0);
    };
    req.open("GET", this._url);
    req.send(null);
  },

  updateSubscriptions: function(userSubs, successCallback, errorCallback) {
    /* jshint -W083 */ // Don't make functions within a loop.
    for (let subName in userSubs) {
      let serial = this.getSubscriptionSerial(subName);
      if (serial === null) {
        continue;
      }
      dprint("Current serial for " + this._name + " " + subName + ": " +
             userSubs[subName].serial);
      dprint("Available serial for " + this._name + " " + subName + ": " +
             serial);
      let subUrl = this.getSubscriptionUrl(subName);
      if (subUrl === null) {
        continue;
      }
      let sub = new Subscription(this._name, subName, subUrl);
      try {
        if (serial > userSubs[subName].serial) {
          sub.update(successCallback, errorCallback);
        } else {
          dprint("No update needed for " + this._name + " " + subName);
          let curSub = sub;
          setTimeout(() => {
            successCallback(curSub, SUBSCRIPTION_UPDATE_NOT_NEEDED);
          }, 0);
        }
      } catch (e) {
        let curSub = sub;
        setTimeout(() => errorCallback(curSub, e.toString()), 0);
      }
    }
    /* jshint +W083 */ // Don't make functions within a loop.
  },

  // getSubscriptionNames : function () {
  //   var names = [];
  //   for (var subName in this._data.subscriptions) {
  //     names.push(subName);
  //   }
  //   return names;
  // },

  getSubscriptionSerial: function(subName) {
    if (!(subName in this._data.subscriptions)) {
      return null;
    }
    return this._data.subscriptions[subName].serial;
  },

  getSubscriptionUrl: function(subName) {
    if (!(subName in this._data.subscriptions)) {
      return null;
    }
    return this._data.subscriptions[subName].url;
  }
};

//==============================================================================
// Subscription
//==============================================================================

/**
 * Represents a particular subscription policy available through a given
 * subscription list.
 *
 * @param {string} listName
 * @param {string} subName
 * @param {string} subUrl
 */
function Subscription(listName, subName, subUrl) {
  // TODO: allow only ascii lower letters, digits, and hyphens in listName.
  this._list = listName;
  // TODO: allow only ascii lower letters, digits, and hyphens in subName.
  this._name = subName;
  this._url = subUrl;
}

Subscription.prototype = {
  _list: null,
  _name: null,
  _url: null,
  _data: null,

  toString: function() {
    return "[Subscription " + this._list + " " + this._name + " " +
        this._url + "]";
  },

  update: function(successCallback, errorCallback) {
    dprint("Updating " + this.toString());

    var req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
      .createInstance(Components.interfaces.nsIXMLHttpRequest);
    var self = this;
    req.onload = function(event) {
      try {
        self._rawData = req.responseText;
        if (!self._rawData) {
          let error = "Empty response when requesting subscription file";
          setTimeout(() => errorCallback(self, error), 0);
          return;
        }
        self._data = JSON.parse(req.responseText);
        // Make sure there's a ['metadata']['serial'] key as a way of sanity
        // checking the parsed JSON as well as enforcing the use of serial
        // numbers in subscription rulesets.
        let serial;
        try {
          serial = self._data.metadata.serial;
        } catch (e) {
          let error = "Ruleset has no serial number";
          setTimeout(() => errorCallback(self, error), 0);
          return;
        }
        if (typeof serial !== "number" || serial % 1 !== 0) {
          let error = "Ruleset has invalid serial number: " + serial;
          setTimeout(() => errorCallback(self, error), 0);
          return;
        }
        // The rest of the sanity checking is done by RawRuleset().
        try {
          var rawRuleset = new RawRuleset(self._rawData);
          RulesetStorage.saveRawRulesetToFile(rawRuleset, self._name + ".json",
                self._list);
        } catch (e) {
          setTimeout(() => errorCallback(self, e.toString()), 0);
          return;
        }
        var subInfo = {};
        subInfo[self._list] = {};
        subInfo[self._list][self._name] = true;
        Services.obs.notifyObservers(null, SUBSCRIPTION_UPDATED_TOPIC,
            JSON.stringify(subInfo));
        setTimeout(() => {
          successCallback(self, SUBSCRIPTION_UPDATE_SUCCESS);
        }, 0);
      } catch (e) {
        setTimeout(() => errorCallback(self, e.toString()), 0);
      }
    };
    req.onerror = function(event) {
      setTimeout(() => errorCallback(self, req.statusText), 0);
    };
    req.open("GET", this._url);
    req.send(null);
  }

};
