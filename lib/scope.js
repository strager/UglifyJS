var pro = require('./process'),
    ast_walker = pro.ast_walker,
    is_identifier = pro.is_identifier,
    MAP = pro.MAP;

function Scope(parent) {
        this.names = [];        // name objects defined in this scope
        this.parent = parent;   // parent scope
        this.name_refs = [];    // names referenced by this scope
        this.children = [];     // sub-scopes
        this.global = this;     // global namespace
        if (parent) {
                parent.children.push(this);
                this.global = parent.global;
        }
        this.is_global = this.global == this;
};

Scope.prototype = {
        lookup_here: function(name) {
                if (this.names.indexOf(name) >= 0)
                        return this;
        },
        lookup: function(name) {
                for (var s = this; s; s = s.parent) {
                        var n = s.lookup_here(name);
                        if (n) return n;
                }
        },
        can_rename: function(name, nameString) {
                if (!is_identifier(nameString)) return false;

                var stop = {};

                try {
                        // Ensure that the new name:

                        // 1. isn't the same as another name defined in this
                        //    scope
                        if (this.get_name_here(nameString)) return false;

                        var existingName = this.get_name(nameString);

                        this.walk(function(scope) {
                                // 2. doesn't shadow a mangled name from a
                                //    parent scope, unless we don't reference
                                //    the original name from this scope OR from
                                //    any sub-scopes!
                                scope.name_refs.forEach(function(nameRef) {
                                        if (nameRef.toString() == nameString) throw stop;
                                });

                                // 3. doesn't shadow an original name from a
                                //    parent scope, in the event that the name
                                //    is not mangled in the parent scope and we
                                //    reference that name here OR IN ANY
                                //    SUBSCOPES!
                                if (existingName && scope.get_name_here(nameString)) throw stop;
                        });
                } catch (e) {
                        if (e == stop) return false;
                        throw e;
                }

                return true;
        },
        get_name_here: function(nameString) {
                nameString = nameString.toString();

                for (var i = 0; i < this.names.length; ++i)
                        if (this.names[i].toString() == nameString)
                                return this.names[i];
        },
        get_name: function(nameString, createGlobal) {
                nameString = nameString.toString();

                for (var s = this; s; s = s.parent) {
                        var name = s.get_name_here(nameString);
                        if (name) return name;
                }

                if (createGlobal) {
                        var name = new Name(nameString);
                        name.is_implicit_global = true;
                        return this.global.define(name);
                }
        },
        reference: function(name) {
                if (!(name instanceof Name)) throw new Error();
                this.name_refs.push(name);
                name.ref_scopes.push(this);
                return name;
        },
        define: function(name) {
                if (this.names.indexOf(name) >= 0) return name;
                this.names.push(name);
                name.def_scope = this;
                return name;
        },
        walk: function(callback) {
                callback(this);
                this.children.forEach(function(child) {
                        child.walk(callback);
                });
        },
        level: function() {
                var level = 0;
                for (var s = this; s; s = s.parent)
                        ++level;
                return level;
        }
};

function WithScope(parent) {
        Scope.call(this, parent);
};

WithScope.prototype = new Scope();

WithScope.prototype.get_name = function(nameString, createGlobal) {
        var name = this.get_name_here(nameString);
        if (name) return name;

        name = Scope.prototype.get_name.call(this, nameString, createGlobal);
        if (name) return this.define(name);
};

WithScope.prototype.define = function(name) {
        var existing = this.lookup_here(name);
        if (existing) return existing;

        var withName = new WithName(name.toString(), name);

        return Scope.prototype.define.call(this, withName);
};

function Name(string) {
        this.string = string;           // string identifier representation in code
        this.is_implicit_global = false;// true if this name was referenced but not defiend
        this.ref_scopes = [];           // scopes referencing this name
        this.def_scope = null;          // scope this name was defiend in
        this.with_names = [];           // WithNames referencing this name
};

Name.prototype.toString = function() {
        return this.string;
};

Name.prototype.rename = function(newString) {
        this.string = newString;
};

Name.prototype.referenced_by = function(scope) {
        return this.ref_scopes.indexOf(scope) >= 0;
};

function ImmutableName(string) {
        Name.call(this, string);

        this.is_immutable = true;
};

ImmutableName.prototype = new Name();

function WithName(string, name) {
        Name.call(this, string);

        this.without_name = name;
        name.with_names.push(this);
};

WithName.prototype = new Name();

WithName.prototype.toString = function() {
        return this.without_name.toString();
};

WithName.prototype.rename = function(newString) {
        this.without_name.rename(newString);
};

function ast_scope_annotate(ast) {
        var w = ast_walker(), walk = w.walk;
        var current_scope = new Scope();

        function with_scope(scope, cont) {
                var old_scope = current_scope;
                current_scope = scope;
                var ret = cont();
                current_scope = old_scope;
                return ret;
        };

        function annotate(ast, scope) {
                ast.scope = scope;
                return ast;
        };

        function define(nameString) {
                var name;
                if (typeof nameString == "string") {
                        name = new Name(nameString);
                } else {
                        name = nameString;
                }
                return current_scope.define(name);
        };

        function reference(nameString) {
                var name;
                if (typeof nameString == "string" || nameString instanceof Array) {
                        name = current_scope.get_name(String(nameString), true);
                } else {
                        name = nameString;
                }
                return current_scope.reference(name);
        };

        function lambda(name, args, body) {
                var is_defun = this[0] == "defun";
                var defined_name = null;
                if (is_defun && name) defined_name = define(name);

                var scope = new Scope(current_scope);
                with_scope(scope, function(){
                        var scope = new Scope(current_scope);
                        if (!is_defun && name) defined_name = define(name);

                        with_scope(scope, function(){
                                current_scope.define(new ImmutableName("arguments"));
                                current_scope.define(new ImmutableName("this"));

                                MAP(args, define);
                                body = annotate(MAP(body, walk), scope);
                        });
                });

                return annotate([ this[0], defined_name, args, body ], scope);
        };

        function var_defs(defs) {
                MAP(defs, function(d) { define(d[0]) });
        };

        function with_block(expr, block) {
                expr = walk(expr);

                var scope = new WithScope(current_scope);
                with_scope(scope, function() {
                        block = walk(block);
                });

                return annotate([ this[0], expr, block ], scope);
        };

        function try_block(t, c, f) {
                if (c != null) return [
                        this[0],
                        MAP(t, walk),
                        [ define(c[0]), MAP(c[1], walk) ],
                        f != null ? MAP(f, walk) : null
                ];
        };

        function toplevel(statements) {
                var scope = new Scope(current_scope);
                with_scope(scope, function() {
                        statements = MAP(statements, walk);
                });

                return annotate([ this[0], statements ], scope);
        };

        function scoped(callback) {
                return function() {
                        var scope = this.scope;
                        if (!scope) throw new Error("Inconsistent scope with " + n[0]);

                        var self = this, args = arguments;

                        return with_scope(scope, function() {
                                return annotate(callback.apply(self, args), scope);
                        });
                };
        };

        function scoped_lambda() {
                return scoped(function(name, args, body) {
                        with_scope(body.scope, function() {
                                body = annotate(MAP(body, walk), body.scope);
                        });
                        return [ this[0], name, args.slice(), body ];
                }).apply(this, arguments);
        };

        // Scope annotation comes in two passes.  The first pass collects
        // definitions (vars, arguments, this, etc.) per-scope.  The second pass
        // notes references to those definitions in each scope.  The passes
        // can't easily be merged because sometimes definitions occur *after* a
        // name is referenced.  Take the following example:
        //
        // foo();
        // function foo() { alert('hi'); }
        //
        // The call to foo must reference the same name as the definition of foo
        // (which occurs later).  Having two passes solves the problem easily.
        ast = w.with_walkers({
                "function": lambda,
                "defun": lambda,
                "var": var_defs,
                "const": var_defs,
                "try": try_block,
                "with": with_block,
                "toplevel": toplevel
        }, function() {
                return walk(ast);
        });

        ast = w.with_walkers({
                "toplevel": scoped(function(statements) {
                        return [ this[0], MAP(statements, walk) ];
                }),
                "function": scoped_lambda,
                "defun": scoped_lambda,
                "try": function(t, c, f) {
                        if (c != null) reference(c[0]);
                },
                "with": scoped(function(expr, block) {
                        return [ this[0], walk(expr), walk(block) ];
                }),
                "name": function(name) {
                        reference(name);
                }
        }, function() {
                return walk(ast);
        });

        return ast;
};

function ast_make_names(ast) {
        if (!ast.scope) ast = ast_scope_annotate(ast);

        var current_scope = new Scope();
        var w = ast_walker(), walk = w.walk;

        function scoped() {
                if (!this.scope) throw new Error("Inconsistent scope with " + this[0]);
                current_scope = this.scope;
        };

        function with_scope(scope, cont) {
                var old_scope = current_scope;
                current_scope = scope;
                var ret = cont();
                current_scope = old_scope;
                return ret;
        };

        function lambda(name, args, body) {
                var is_defun = this[0] == "defun";
                var defined_name = null;
                if (is_defun && name) defined_name = current_scope.get_name(name);

                with_scope(this.scope, function() {
                        if (!is_defun && name) defined_name = current_scope.get_name(name);

                        with_scope(body.scope, function() {
                                args = MAP(args, function(arg) {
                                        return current_scope.get_name(arg);
                                });
                                body = MAP(body, walk);
                        });
                });

                return [ this[0], defined_name, args, body ];
        };

        function var_defs(defs) {
                defs = MAP(defs, function(d) {
                        return [ current_scope.get_name(d[0]), walk(d[1]) ];
                });

                return [ this[0], defs ];
        };

        function try_block(t, c, f) {
                t = MAP(t, walk);
                if (c != null) c = [ current_scope.get_name(c[0]), MAP(c[1], walk) ];
                if (f != null) f = MAP(f, walk);

                return [ this[0], t, c, f ];
        };

        function name(name) {
                return [ this[0], current_scope.get_name(name) ];
        };

        function call(expr, args) {
                // Define args first, then walk the body
                args = MAP(args, walk);
                expr = walk(expr);
                return [ this[0], expr, args ];
        };

        return w.with_walkers({
                "function": lambda,
                "defun": lambda,
                "var": var_defs,
                "const": var_defs,
                "try": try_block,
                "with": scoped,
                "toplevel": scoped,
                "name": name,
                "call": call
        }, function() {
                return walk(ast);
        });
};

function ast_unmake_names(ast) {
        ast = ast_scope_annotate(ast);

        var w = ast_walker(), walk = w.walk;

        function lambda(name, args, body) {
                return [ this[0], name ? String(name) : null, MAP(args, String), MAP(body, walk) ];
        };

        function var_defs(defs) {
                return [ this[0], MAP(defs, function(d) {
                        return [ String(d[0]), walk(d[1]) ];
                }) ];
        };

        function try_block(t, c, f) {
                t = MAP(t, walk);
                if (c != null) c = [ String(c[0]), MAP(c[1], walk) ];
                if (f != null) f = MAP(f, walk);

                return [ this[0], t, c, f ];
        };

        function name(name) {
                return [ this[0], String(name) ];
        };

        function call(expr, args) {
                // Define args first, then walk the body
                args = MAP(args, walk);
                expr = walk(expr);
                return [ this[0], expr, args ];
        };

        return w.with_walkers({
                "function": lambda,
                "defun": lambda,
                "var": var_defs,
                "const": var_defs,
                "try": try_block,
                "name": name,
                "call": call
        }, function() {
                return walk(ast);
        });
};

exports.ast_scope_annotate = ast_scope_annotate;
exports.ast_make_names = ast_make_names;
exports.ast_unmake_names = ast_unmake_names;

exports.Name = Name;
exports.ImmutableName = ImmutableName;
exports.WithName = WithName;
exports.Scope = Scope;
exports.WithScope = WithScope;
