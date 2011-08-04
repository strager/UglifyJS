var pro = require('./process'),
    MAP = pro.MAP;

function _(ast) {
        return true;
}

function many(name, patterns) {
        if (arguments.length < 2) patterns = [ _ ];

        return function(asts, match) {
                var submatches = [];
                next_ast: for (var i = 0; i < asts.length; ++i) {
                        for (var j = 0; j < patterns.length; ++j) {
                                var submatch = {};
                                if (ast_match_into(asts[i], patterns[j], submatch)) {
                                        submatches.push(submatch);
                                        continue next_ast;
                                }
                        }

                        // No pattern matched; bail out
                        return false;
                }

                match[name] = submatches;
                return true;
        };
}

function one(name, pattern) {
        if (arguments.length < 2) pattern = _;

        return function(ast, match) {
                ast = ast.slice();
                var matches = ast_match_into(ast, pattern, ast);
                if (matches) match[name] = ast;
                return matches;
        };
}

function ast_match_into(ast, pattern, match) {
        if (typeof pattern == "function") {
                return pattern(ast, match);
        }

        if (ast.length != pattern.length) return false;

        for (var i = 0; i < ast.length; ++i) {
                var p = pattern[i];
                var a = ast[i];

                if (typeof p == "function" || a instanceof Array) {
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

        function undefined_node(value) {
                return [ "unary-prefix", "void", [ "num", value || 0 ] ]
        }

        function clean_up_node(node) {
                var match = ast_match(node, [ "stat", undefined_node(_) ]);
                if (match) return null;
                else return node;
        }

        return w.with_walkers({
                "call": function(expr, args) {
                        var call = [ this[0], walk(expr), MAP(args, walk) ];
                        var match = ast_match(call, [ "call", [ "function", null, [ ], many("body", [
                                [ "stat", one("assign", [ "assign", _, _, _ ]) ],
                                [ "return", one("retval") ]
                        ]) ], [ ] ]);

                        if (match) {
                                var returned = false;
                                var seqs = MAP(match.body, function(member) {
                                        if (member.retval) returned = true;
                                        return member.assign || member.retval;
                                });

                                if (!returned && w.parent()[0] != "stat") seqs.push(undefined_node());

                                if (seqs.length == 0) return undefined_node();
                                else if (seqs.length == 1) return seqs[0];
                                else return [ "seq" ].concat(seqs);
                        }

                        return match.retval;
                                
                },
                "toplevel": function(statements) {
                        statements = MAP(statements, walk);
                        var nstatements = [];

                        MAP(statements, function(statement) {
                                statement = clean_up_node(statement);
                                if (statement) nstatements.push(statement);
                        });

                        return [ this[0], nstatements ];
                }
        }, function() {
                ast = walk(ast);
                ast = pro.ast_squeeze(ast);
                return ast;
        });
}

exports.ast_squeeze_closures = ast_squeeze_closures;
