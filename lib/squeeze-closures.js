var pro = require('./process'),
    MAP = pro.MAP;

function _(ast) {
        return true;
}

function many(name, patterns) {
}

function one(name, pattern) {
        return function(ast, match) {
                match[name] = ast;
                return true;
        };
}

function ast_match_into(ast, pattern, match) {
        if (ast.length != pattern.length) return false;

        for (var i = 0; i < ast.length; ++i) {
                var p = pattern[i];
                var a = ast[i];

                if (typeof p == "function") {
                        if (!p(a, match)) return false;
                } else if (a instanceof Array) {
                        if (!ast_match_into(a, p, match)) return false;
                } else {
                        if ((p != a) && (p || a)) return false;
                }
        }

        return true;
}

function ast_match(ast, pattern) {
        var match = {};

        if (ast_match_into(ast, pattern, match)) return match;
        else return false;
}

function ast_squeeze_closures(ast) {
        var w = pro.ast_walker(), walk = w.walk;

        return w.with_walkers({
                "call": function(expr, args) {
                        var call = [ this[0], walk(expr), MAP(args, walk) ];
                        var match = ast_match(call, [ "call", [ "function", null, [ ], [
                                [ "return", one("retval") ]
                        ] ], [ ] ]);

                        if (!match) return call;

                        return match.retval;
                                
                }
        }, function() {
                return walk(ast);
        });
}

exports.ast_squeeze_closures = ast_squeeze_closures;
