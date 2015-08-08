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
 * this program. If not, see {tag: "http"://www.gnu.org/licenses}.
 *
 * ***** END LICENSE BLOCK *****
 */

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

Cu.import("chrome://rpcontinued/content/lib/script-loader.jsm");
ScriptLoader.importModules([
  "lib/logger",
  "lib/utils/strings",
  "lib/utils/constants"
], this);

var EXPORTED_SYMBOLS = ["XULUtils"];

var XULUtils = {};

var xulTrees = XULUtils.xulTrees = {};

var xulTreesScope = {
  "exports": xulTrees,
  "C": C,
  "appID": Services.appinfo.ID
};

Services.scriptloader.loadSubScript(
    'chrome://rpcontinued/content/ui/xul-trees.js',
    xulTreesScope);


function getParentElement(aDocument, aElementSpec) {
  if (!aElementSpec.parent) {
    return false;
  } else {
    if (aElementSpec.parent.id) {
      return aDocument.getElementById(aElementSpec.parent.id);
    } else if (aElementSpec.parent.special) {
      switch (aElementSpec.parent.special.type) {
        case "__window__":
          return aDocument.querySelector("window");

        case "subobject":
          let subobjectTree = aElementSpec.parent.special.tree;
          let parentElement = aDocument.getElementById(aElementSpec.parent
                                                                   .special.id);
          for (let i = 0, len = subobjectTree.length; i < len; ++i) {
            parentElement = parentElement[subobjectTree[i]];
          }
          return parentElement;

        default:
          return false;
      }
    } else {
      return false;
    }
  }
}

function isAttribute(aElementSpec, aAttributeName) {
  return aAttributeName !== "children" && aAttributeName !== "parent" &&
      aAttributeName !== "tag" && aElementSpec.hasOwnProperty(aAttributeName);
}

function getAttrValue(aElementSpec, aAttrName) {
  if (!isAttribute(aElementSpec, aAttrName)) {
    return false;
  }
  let value = aElementSpec[aAttrName];
  if (value.charAt(0) == "&" && value.charAt(value.length-1) == ";") {
    try {
      value = StringUtils.$str(value.substr(1, value.length-2));
    } catch (e) {
      Logger.severe(Logger.TYPE_ERROR, e, e);
      return false;
    }
  }
  return value;
}

function setAttributes(aElement, aElementSpec) {
  for (let attr in aElementSpec) {
    let value = getAttrValue(aElementSpec, attr);
    if (value) {
      aElement.setAttribute(attr, value);
    }
  }
}


function recursivelyAddXULElements(aDocument, aElementSpecList,
                                   aParentElement = null) {
  for (let elementSpec of aElementSpecList) {
    if (!elementSpec || !elementSpec.tag) {
      continue;
    }
    let parentElement = !!aParentElement ? aParentElement :
        getParentElement(aDocument, elementSpec);
    if (false === parentElement) {
      continue;
    }
    if (parentElement === null) {
      Logger.warning(Logger.TYPE_ERROR,
                     "parentElement of '" + elementSpec.id + "' is null!");
      continue;
    }

    let newElement = aDocument.createElement(elementSpec.tag);
    setAttributes(newElement, elementSpec);
    if (elementSpec.children) {
      recursivelyAddXULElements(aDocument, elementSpec.children, newElement);
    }
    parentElement.appendChild(newElement);
  }
};

XULUtils.addTreeElementsToWindow = function(aWin, aTreeName) {
  if (xulTrees.hasOwnProperty(aTreeName)) {
    recursivelyAddXULElements(aWin.document, xulTrees[aTreeName]);
  }
}

var elementIDsToRemove = {};

function getElementIDsToRemove(aTreeName) {
  if (elementIDsToRemove.hasOwnProperty(aTreeName)) {
    return elementIDsToRemove[aTreeName];
  }
  let ids = elementIDsToRemove[aTreeName] = [];
  let tree = xulTrees[aTreeName];
  for (let i in tree) {
    ids.push(tree[i].id);
  }
  return ids;
}

XULUtils.removeTreeElementsFromWindow = function(aWin, aTreeName) {
  if (!xulTrees.hasOwnProperty(aTreeName)) {
    return;
  }
  let tree = xulTrees[aTreeName];
  let elementIDs = getElementIDsToRemove(aTreeName);

  for (let i in elementIDs) {
    let id = elementIDs[i];
    let node = aWin.document.getElementById(id);
    if (node && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }
}
