var pro = require('./process'),
    MAP = pro.MAP;

var scope = require('./scope');

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

        function walk_and_split_vars(ast) {
                function statements(stats) {
                        var nstats = [];

                        MAP(MAP(stats, walk), function(stat) {
                                if (stat[0] == "var") {
                                        MAP(stat[1], function(def) {
                                                nstats.push([ "var", [ def ] ]);
                                        });
                                } else {
                                        nstats.push(stat);
                                }
                        });

                        return nstats;
                }

                return w.with_walkers({
                        // TODO More containers of var

                        "function": function(name, args, body) {
                                return [ this[0], name, args.slice(), statements(body) ];
                        }
                }, function() {
                        return walk(ast);
                });
        }

        function is_arguments_referenced(ast) {
                var w = pro.ast_walker(), walk = w.walk;

                var arguments_referenced = false;

                function lambda(name, args, body) {
                        return [];
                }

                w.with_walkers({
                        "function": lambda,
                        "defun": lambda,
                        "name": function(name) {
                                if (name == "arguments") arguments_referenced = true;
                        }
                }, function() {
                        walk(ast);
                });

                return arguments_referenced;
        }

        function map_statements(statements, fn) {
                return fn([ "toplevel", statements ])[1];
        }

        var rename_counter = 0;

        function rename_name(name) {
                // Not guaranteed to work, but I am lazy.
                ++rename_counter;
                name.string += '__squeezed_closure__' + rename_counter;
                return name;
        }

        function can_expand_body(body) {
                return !body.some(is_conditionally_terminated) && !body.some(is_arguments_referenced);
        }

        return w.with_walkers({
                "call": function(expr, args) {
                        var call = [ this[0], walk(expr), MAP(args, walk) ];
                        var match = ast_match(call, [ "call", [ "function", null, [ ], many("body", [
                                [ "stat", one("assign", [ "assign", _, _, _ ]) ],
                                [ "stat", one("call", [ "call", _, _ ]) ],
                                [ "return", one("retval") ]
                        ]) ], [ ] ]);

                        if (match && can_expand_body(match.body)) {
                                var returned = false;
                                var seqs = MAP(match.body, function(member) {
                                        if (member.retval) returned = true;
                                        return member.assign || member.call || member.retval;
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

                        MAP(map_statements(map_statements(body, walk_and_split_vars), scope.ast_make_names), function(stat) {
                                var fcallPattern = [ "call", [ "function", null, [ ], many("body", [
                                        [ "return", one("retval") ],
                                        one("vardef", [ "var", _ ]),
                                        one("statement", _)
                                ]) ], [ ] ];

                                var fcallMatch = ast_match(stat, fcallPattern);
                                var assignMatch = ast_match(stat, [ "stat", [ "assign", one("op"), one("lvalue"), fcallPattern ] ]);
                                var varMatch = ast_match(stat, [ "var", [ [ one("name"), fcallPattern ] ] ]);
                                var match = fcallMatch || assignMatch || varMatch;

                                if (match && can_expand_body(match.body)) {
                                        var returned = null;
                                        MAP(match.body, function(node) {
                                                if (returned) return;

                                                if (node.retval) {
                                                        returned = node.retval;
                                                } else if (node.vardef) {
                                                        nbody.push([ "var", MAP(node.vardef[1], function(def) {
                                                                return [ rename_name(def[0]), def[1] ];
                                                        }) ]);
                                                } else {
                                                        nbody.push(node.statement);
                                                }
                                        });

                                        if (assignMatch) {
                                                // XXX This is an unsafe transformation if lvalue has
                                                // side-effects or can change due to rvalue's
                                                // side-effects.
                                                nbody.push([ "stat", [ "assign", assignMatch.op, assignMatch.lvalue, returned || undefined_node() ] ]);
                                        } else if (varMatch) {
                                                nbody.push([ "var", [ [ varMatch.name, returned || undefined_node() ] ] ]);
                                        } else if (fcallMatch) {
                                                if (returned) nbody.push([ "stat", returned ]);
                                        }
                                } else {
                                        nbody.push(stat);
                                }
                        });

                        nbody = MAP(nbody, scope.ast_unmake_names);

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
                return walk(ast);
        });
}

exports.ast_squeeze_closures = ast_squeeze_closures;
