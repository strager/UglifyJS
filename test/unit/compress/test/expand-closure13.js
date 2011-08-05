(function () {
    var C,
        r = (function (a) {
        return function (c, d, e) {
            a(c, d, function () { return e; });
        };
    }(C));
}());
