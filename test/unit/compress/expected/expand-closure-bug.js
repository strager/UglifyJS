(function() {
    var right = function(a, b, c) {
            a.__defineGetter__(b, c);
    };
    var left = function(b, c, d) {
        right(b, c, function() {
            return d;
        });
    };
})(Object);
