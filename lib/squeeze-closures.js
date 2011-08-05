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
                        var ast = asts[i];

                        for (var j = 0; j < patterns.length; ++j) {
                                var pattern = patterns[j];

                                var submatch;
                                if (ast instanceof Array) {
                                        ast = ast.slice();
                                        submatch = ast;
                                } else {
                                        submatch = {};
                                }

                                if (ast_match_into(ast, pattern, submatch)) {
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
                var submatch;
                if (ast instanceof Array) {
                        ast = ast.slice();
                        submatch = ast;
                } else {
                        submatch = {};
                }

                var matches = ast_match_into(ast, pattern, submatch);
                if (matches) match[name] = ast;
                return matches;
        };
}

function ast_match_into(ast, pattern, match) {
        if (typeof pattern == "function") {
                return pattern(ast, match);
        }

        if (!(ast instanceof Array)) {
                return pattern == ast;
        }

        if (ast.length != pattern.length) return false;

        for (var i = 0; i < ast.length; ++i) {
                var p = pattern[i];
                var a = ast[i];

                if (!ast_match_into(a, p, match)) return false;
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

        function is_conditionally_terminated(ast) {
                var w = pro.ast_walker(), walk = w.walk;
                var terminated = false;
                var conditional_count = 0;

                function cond_start() {
                        ++conditional_count;
                };

                function cond_end() {
                        --conditional_count;
                };

                function lambda() {
                        return [ ];
                };

                function halt() {
                        if (conditional_count > 0) terminated = true;
                        return [ ];
                };

                w.with_walkers({
                        "function": lambda,
                        "defun": lambda,
                        "return": halt,
                        "try": halt,
                        "if": function(conditional, t, e) {
                                cond_start();
                                var ret = [ this[0], walk(conditional), walk(t), walk(e) ];
                                cond_end();
                                return ret;
                        },
                        "for": function(init, cond, step, block) {
                                cond_start();
                                var ret = [ this[0], walk(init), walk(cond), walk(step), walk(block) ];
                                cond_end();
                                return ret;
                        },
                        "for-in": function(vvar, key, hash, block) {
                                cond_start();
                                var ret = [ this[0], walk(vvar), walk(key), walk(hash), walk(block) ];
                                cond_end();
                                return ret;
                        },
                        "while": function(cond, block) {
                                cond_start();
                                var ret = [ this[0], walk(cond), walk(block) ];
                                cond_end();
                                return ret;
                        },
                        "do": function(cond, block) {
                                // do loops aren't a problem because their
                                // bodies are run at least once
                                return;
                        }
                }, function() {
                        w.walk(ast);
                });

                return terminated;
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
                "function": function(name, args, body) {
                        var nbody = [];

                        MAP(body, function(stat) {
                                stat = walk(stat);

                                var fcallPattern = [ "call", [ "function", null, [ ], many("body", [
                                        [ "return", one("retval") ],
                                        one("statement", _)
                                ]) ], [ ] ];

                                var fcallMatch = ast_match(stat, fcallPattern);
                                var assignMatch = ast_match(stat, [ "stat", [ "assign", one("op"), one("lvalue"), fcallPattern ] ]);

                                var match = fcallMatch || assignMatch;
                                if (match && !match.body.some(is_conditionally_terminated)) {
                                        var returned = null;
                                        MAP(match.body, function(node) {
                                                if (returned) return;

                                                if (node.retval) {
                                                        returned = node.retval;
                                                } else {
                                                        nbody.push(node.statement);
                                                }
                                        });

                                        if (assignMatch) {
                                                // XXX This is an unsafe transformation if lvalue has
                                                // side-effects or can change due to rvalue's
                                                // side-effects.
                                                nbody.push([ "stat", [ "assign", assignMatch.op, assignMatch.lvalue, returned || undefined_node() ] ]);
                                        } else if (fcallMatch) {
                                                if (returned) nbody.push([ "stat", returned ]);
                                        }
                                } else {
                                        nbody.push(stat);
                                }
                        });

                        return [ this[0], name, args.slice(), nbody ];
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
