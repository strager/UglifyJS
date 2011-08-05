(function () {
    var a = (function () { return 42; }()),
        b = (function (b) {
            return function () {
                return a;
            };
        }(a));
    die(b);
}());
