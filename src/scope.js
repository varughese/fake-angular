function initWatchVal() {}

function Scope() {
    this.$$watchers = [];
    this.$$lastDirtyWatch = null;
    this.$$asyncQueue = [];
    this.$$applyAsyncQueue = [];
    this.$$applyAsyncId = null;
    this.$root = this;
    this.$$children = [];
    this.$$phase = null;
}

Scope.prototype.$watch = function(watchFn, listenerFn, valueEq) {
    var self = this;
    var watcher = {
        watchFn: watchFn,
        listenerFn: listenerFn || function() {},
        valueEq: !!valueEq,
        last: initWatchVal
    };
    this.$$watchers.unshift(watcher);
    this.$$lastDirtyWatch = null;
    return function() {
        var index = self.$$watchers.indexOf(watcher);
        if (index >= 0) {
            self.$$watchers.splice(index, 1);
            self.$$lastDirtyWatch = null;
        }
    };
};

Scope.prototype.$$areEqual = function(newValue, oldValue, valueEq) {
    if (valueEq) {
        return _.isEqual(newValue, oldValue);
    } else {
        return newValue === oldValue ||
            (typeof newValue === 'number' && typeof oldValue === 'number' &&
                isNaN(newValue) && isNaN(oldValue));
    }
};

Scope.prototype.$$digestOnce = function() {
    var dirty;
    var continueLoop = true;
    var self = this;
    this.$$everyScope(function(scope) {
        var newValue, oldValue;

        _.forEachRight(scope.$$watchers, function(watcher) {
            newValue = watcher.watchFn(scope);
            oldValue = watcher.last;
            if (!scope.$$areEqual(newValue, oldValue, watcher.valueEq)) {
                self.$$lastDirtyWatch = watcher;
                watcher.last = (watcher.valueEq ? _.cloneDeep(newValue) : newValue);
                watcher.listenerFn(newValue,
                    (oldValue === initWatchVal ? newValue : oldValue),
                    scope);
                dirty = true;
            } else if (self.$$lastDirtyWatch === watcher) {
                continueLoop = false;
                return false;
            }
        });
        return continueLoop;
    });
    return dirty;
};

Scope.prototype.$digest = function() {
    var ttl = 10;
    var dirty;
    this.$$lastDirtyWatch = null;
    this.$beginPhase("$digest");

    if (this.$$applyAsyncId) {
        clearTimeout(this.$$applyAsyncId);
        this.$$flushApplyAsync();
    }

    do {
        while (this.$$asyncQueue.length) {
            var asyncTask = this.$$asyncQueue.shift();
            asyncTask.scope.$eval(asyncTask.expression);
        }
        dirty = this.$$digestOnce();
        if ((dirty || this.$$asyncQueue.length) && !(ttl--)) {
            this.$clearPhase();
            throw "10 digest iterations reached!";
        }
    } while (dirty || this.$$asyncQueue.length);
    this.$clearPhase();
};

Scope.prototype.$eval = function(expr, locals) {
    return expr(this, locals);
};

Scope.prototype.$apply = function(expr) {
    try {
        this.$beginPhase("$apply");
        return this.$eval(expr);
    } finally {
        this.$clearPhase();
        this.$root.$digest();
    }
};

Scope.prototype.$evalAsync = function(expr) {
    var self = this;
    if (!self.$$phase && !self.$$asyncQueue.length) {
        setTimeout(function() {
            if (self.$$asyncQueue.length) {
                self.$digest();
            }
        }, 0);
    }
    this.$$asyncQueue.push({
        scope: this,
        expression: expr
    });
};

Scope.prototype.$beginPhase = function(phase) {
    if (this.$$phase) {
        throw this.$$phase + " already in progress.";
    }
    this.$$phase = phase;
};

Scope.prototype.$clearPhase = function() {
    this.$$phase = null;
};

Scope.prototype.$applyAsync = function(expr) {
    var self = this;
    self.$$applyAsyncQueue.push(function() {
        self.$eval(expr);
    });
    if (self.$$applyAsyncId === null) {
        self.$$applyAsyncId = setTimeout(function() {
            self.$apply(_.bind(self.$$flushApplyAsync, self));
        }, 0);
    }
};

Scope.prototype.$$flushApplyAsync = function() {
    while (this.$$applyAsyncQueue.length) {
        this.$$applyAsyncQueue.shift()();
    }
    this.$$applyAsyncId = null;
};

Scope.prototype.$watchGroup = function(watchFns, listenerFn) {
    var self = this;
    var newValues = new Array(watchFns.length);
    var oldValues = new Array(watchFns.length);
    _.forEach(watchFns, function(watchFn, i) {
        self.$watch(watchFn, function(newValue, oldValue) {
            newValues[i] = newValue;
            oldValues[i] = oldValue;
            listenerFn(newValues, oldValues, self);
        });
    });
};

Scope.prototype.$new = function(isolated, parent) {
    var child;
    parent = parent || this;
    if (isolated) {
        child = new Scope();
        child.$root = parent.$root;
    } else {
        child = Object.create(this);
    }
    parent.$$children.push(child);
    child.$$watchers = [];
    child.$$children = [];
    child.$parent = parent;
    return child;
};

Scope.prototype.$$everyScope = function(fn) {
    if (fn(this)) {
        return this.$$children.every(function(child) {
            return child.$$everyScope(fn);
        });
    } else {
        return false;
    }
};

Scope.prototype.$destroy = function() {
    if (this.$parent) {
        var siblings = this.$parent.$$children;
        var indexOfThis = siblings.indexOf(this);
        if (indexOfThis >= 0) {
            siblings.splice(indexOfThis, 1);
        }
    }
    this.$$watchers = null;
};
