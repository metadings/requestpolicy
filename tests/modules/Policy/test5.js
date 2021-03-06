
var policy = new Ruleset();

dprint("== Allow all requests to https://127.0.0.1:8888/baz ==");
var host = policy.addHost("127.0.0.1");
var r = host.rules.add("https", 8888);
r.path = "/baz";
r.destinationRuleAction = RULE_ACTION_ALLOW;
dprint("=======");

dprint("== Allow all requests from [::1] to https://[a:b::c] ==");
var host = policy.addHost("::1");
var r = host.rules.add();
r.initDestinations();
var destHost = r.destinations.addHost("a:b::c");
var destRule = destHost.rules.add("https");
destRule.destinationRuleAction = RULE_ACTION_ALLOW;
dprint("=======");


policy.print();


var tests = [];

tests.push({"origin" : "https://foo.com/",
            "dest" : "https://localhost:8888/ba",
            "allowCount" : 0,
            "denyCount" : 0});

tests.push({"origin" : "https://localhost:8888/baz",
            "dest" : "https://localhost:8888/ba",
            "allowCount" : 0,
            "denyCount" : 0});

tests.push({"origin" : "https://foo.com/",
            "dest" : "https://localhost/baz",
            "allowCount" : 0,
            "denyCount" : 0});

tests.push({"origin" : "https://foo.com/",
            "dest" : "https://127.0.0.1:8443/baz",
            "allowCount" : 0,
            "denyCount" : 0});

tests.push({"origin" : "https://foo.com/",
            "dest" : "http://localhost:8888/baz",
            "allowCount" : 0,
            "denyCount" : 0});

tests.push({"origin" : "https://foo.com/",
            "dest" : "http://localhost/baz",
            "allowCount" : 0,
            "denyCount" : 0});

tests.push({"origin" : "https://foo.com/",
            "dest" : "https://localhost:443/baz",
            "allowCount" : 0,
            "denyCount" : 0});

tests.push({"origin" : "https://foo.com/",
            "dest" : "http://localhost:80/baz",
            "allowCount" : 0,
            "denyCount" : 0});

tests.push({"origin" : "https://foo.com/",
            "dest" : "https://localhost:8888/baz",
            "allowCount" : 1,
            "denyCount" : 0});

tests.push({"origin" : "https://foo.com/",
            "dest" : "https://localhost:8888/bazbaz",
            "allowCount" : 1,
            "denyCount" : 0});

runPolicyTests(policy, tests);
