var pro = require('./process'),
    MAP = pro.MAP,
    gen_code = pro.gen_code;

function inject_comment(ast, comment_text) {
        var injected = false;

        var comment = '/*' + comment_text.replace(/\*\//g, '* /') + '*/';

        function comment_ast() {
                return [ "atom", comment ];
        };

        var w = pro.ast_walker(), walk = w.walk;

        function many(nodes) {
                if (injected)
                        return nodes;

                var lengths = MAP(nodes, function(ast) {
                        return gen_code(ast).length;
                });

                var total_length = lengths.reduce(function(acc, num) {
                        return acc + num;
                }, 0);

                var i;
                var running_total = 0;
                for (i = 0; i < nodes.length; ++i) {
                        running_total += lengths[i];
                        if (running_total >= total_length / 2) {
                                break;
                        }
                }

                if (i == nodes.length)
                        i = nodes.length - 1;

                if (i >= 0) {
                        nodes = nodes.slice();
                        nodes[i] = walk(nodes[i]);
                        if (!injected) {
                                injected = true;
                                nodes.splice(i, 0, comment_ast());
                        }
                        return nodes;
                } else {
                        injected = true;
                        return [ comment_ast() ];
                }
        };

        function lambda(name, args, body) {
                return [ this[0], name, args, many(body) ];
        };

        function toplevel(statements) {
                return [ this[0], many(statements) ];
        };

        return w.with_walkers({
                "toplevel": toplevel,
                "defun": lambda,
                "function": lambda
        }, function() {
                return walk(ast);
        });
};

exports.inject_comment = inject_comment;
