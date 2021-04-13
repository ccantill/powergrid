var animFrameQueue = [], inAnimFrame = false, animFrameRequested = false;

var pathRegex = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]/g;

function parsePath(key) {
    var p = [];
    if (key.replace) {
        key.replace(pathRegex, function (a, b) {
            if (b !== undefined) {
                p.push(parseInt(b));
            } else {
                p.push(a);
            }
        });
        return p;
    }

    return [key];
}

function getValue(object, key) {
    var o = object;
    for (var p = parsePath(key), x = 0, l = p.length; x < l; x++) {
        if (o === undefined || o === null) {
            return o;
        }
        o = o[p[x]];
    }
    return o;
}

function setValue(object, key, value) {
    var o = object,
        p = parsePath(key);
    for (var x = 0, l = p.length - 1; x < l; x++) {
        o = o[p[x]];
    }
    o[p[x]] = value;
}

export function createElement(tag, attributes, content) {
    var element = document.createElement(tag);
    if (typeof attributes == 'string' || Array.isArray(attributes)) {
        content = attributes;
        attributes = undefined;
    }
    if (attributes) {
        for (var x in attributes) {
            if (attributes.hasOwnProperty(x) && attributes[x] !== false) {
                element.setAttribute(x, attributes[x]);
            }
        }
    }
    if (typeof content == 'string') {
        element.textContent = content;
    } else if (Array.isArray(content)) {
        for (var x = 0, l = content.length; x < l; x++) {
            element.appendChild(content[x]);
        }
    }
    return element;
}

function normalizeOptions(options) {
    if (Array.isArray(options)) {
        return options;
    } else {
        return Object.keys(options).map(function (key) {
            return {
                value: key,
                label: options[key]
            };
        });
    }
}

/**
 * Allows event handlers to be registered
 * @interface EventSource
 */

/**
 * An {@link EventSource} implementation.
 * @class
 * @implements {EventSource}
 */
export function Evented() {
    var handlers = {};
    /**
     * Registers an event handler. Use the 'cancel' function in the returned object to remove the event handler.
     * @function EventSource#on
     * @param eventName
     * @param handler
     * @returns {{cancel: cancel}}
     */
    this.on = function (eventName, handler) {
        var self = this;
        if (eventName in handlers) {
            handlers[eventName] = handlers[eventName].concat(handler);
        } else {
            handlers[eventName] = [handler];
        }
        return {
            cancel: function () {
                self.off(eventName, handler);
            }
        }
    };

    /**
     * Fires an event
     * @function Evented#trigger
     * @param eventName
     */
    this.trigger = function (eventName) {
        var self = this, args = Array.apply(null, arguments).slice(1);
        if (eventName in handlers) {
            handlers[eventName].forEach(function (handler) {
                handler.apply(self, args);
            });
        }
    };

    /**
     * Registers a one-time event handler. The handler will only be invoked once, the next time the event is fired.
     * Use the 'cancel' function in the returned object to remove the event handler.
     * @function EventSource#one
     * @param eventName
     * @param handler
     * @returns {{cancel: cancel}}
     */
    this.one = function (eventName, handler) {
        var self = this;
        var selfDestructingHandler = (function () {
            self.off(eventName, selfDestructingHandler);
            handler.apply(this, arguments);
        });

        this.on(eventName, selfDestructingHandler);

        return {
            cancel: function () {
                self.off(eventName, selfDestructingHandler);
            }
        }
    };

    /**
     * Removes an event handler.
     * @function EventSource#off
     * @param eventName
     * @param handler
     */
    this.off = function (eventName, handler) {
        var idx = handlers[eventName].indexOf(handler);
        if (idx > -1) {
            handlers[eventName].splice(idx, 1);
        }
    };

    /**
     * Passes events through from another EventSource
     * @function EventSource#passthroughFrom
     * @param {EventSource} target - the other EventSource whose events should be passed through
     * @param {...string} eventNames - the names of the events that should be passed through
     */
    this.passthroughFrom = function (target) {
        var self = this;
        for (var x = 1; x < arguments.length; x++) {
            (function (eventName) {
                target.on(eventName, function () {
                    self.trigger.apply(self, [eventName].concat(arguments));
                });
            })(arguments[x]);
        }
    };
}

function findRanges(indeces) {
    var ranges = [];
    indeces.sort(function (a, b) {
        return a - b;
    });

    var prevIdx = indeces[0], currentCount = 1;
    for (var x = 1; x < indeces.length; x++) {
        if (indeces[x] == indeces[x - 1] + 1) {
            currentCount++;
        } else {
            ranges.push({start: prevIdx, count: currentCount});
            prevIdx = indeces[x];
            currentCount = 1;
        }
    }

    ranges.push({start: prevIdx, count: currentCount});
    return ranges;
}

function SubscriptionQueue() {
    var cancelled = false;

    this.queue = function (cb) {
        return function () {
            if (!cancelled) {
                cb.apply(this, arguments);
            }
        }
    };

    this.cancel = function () {
        cancelled = true;
    };

    this.isCancelled = function () {
        return cancelled;
    }

    this.assert = function () {
        if (cancelled) {
            throw new Error("Subscription cancelled");
        }
    }
}

function calculateDifference(a, b) {
    // Utility function. Generates a list of actions (add, remove) to take to get from list a to list b.
    // Extremely useful when doing incremental DOM tree updates from one dataset to another.
    // WARNING: the resulting diff is only optimal in cases where the order of the items was not changed between a and b

    function idMap(a) {
        var m = {};
        for (var x = 0, l = a.length; x < l; x++) m[a[x].id] = a[x];
        return m;
    }

    // special cases
    if (!a.length && !b.length) return [];
    if (!a.length) return [{add: {start: 0, end: b.length}}];
    if (!b.length) return [{remove: {start: 0, end: a.length}}];

    var diff = [], lastdiff;
    var ia = idMap(a);
    var c = [];
    // first find rows to remove
    for (var xa = a.length - 1, xb = b.length - 1; xa >= 0;) {
        // find next item in b that is also in a
        while (xb >= 0 && !(b[xb].id in ia)) {
            xb--;
        }
        if (xb < 0) {
            // no item in b found that is also in a, so we remove everything from the start to the position of the last common item in both
            diff.push({remove: {start: 0, end: xa + 1}});
            break;
        } else {
            var sa = xa;
            // find the index of that item in a
            while (xa >= 0 && a[xa].id !== b[xb].id) {
                xa--;
            }
            if (xa >= 0) {
                c.unshift(a[xa]);
            }
            if (xa !== sa) {
                diff.push({remove: {start: xa + 1, end: sa + 1}});
            }
            xa--;
            xb--;
        }
    }

    // find the ones to add now. since these operations will be done
    // on a subset of a that only contains the items also in b, we
    // use c as a base.
    if (c.length == 0) {
        // apparently there was no overlap between a and b, so all of b can be added
        diff.push({add: {start: 0, end: b.length}});
    } else {
        for (var xc = 0, xb = 0; xb < b.length && xc < c.length;) {
            while (xb < b.length && xc < c.length && c[xc].id === b[xb].id) {
                xc++;
                xb++;
            }

            if (xb >= b.length)
                break;

            var sb = xb;

            if (xc >= c.length) {
                xb = b.length;
            } else {
                while (c[xc].id !== b[xb].id) {
                    xb++;
                }
            }
            if (sb !== xb) {
                diff.push({add: {start: sb, end: xb}});
            }
        }
    }
    return diff;
}

function incrementalUpdate(dataSource, oldData, newData) {
    var diff = calculateDifference(oldData, newData);
    for (var x = 0, l = diff.length; x < l; x++) {
        var d = diff[x];
        if (d.add) {
            dataSource.trigger('rowsadded', d.add);
        } else if (d.remove) {
            dataSource.trigger('rowsremoved', d.remove);
        }
    }
}

function addSingleUseEventListener(eventTarget, type, handler) {
    function f() {
        eventTarget.removeEventListener(type, f);
        handler.apply(this, arguments);
    }

    eventTarget.addEventListener(type, f);
}

function offset(target) {
    var rect = target.getBoundingClientRect();
    return {
        top: rect.top + document.body.scrollTop,
        left: rect.left + document.body.scrollLeft
    }
}

function overlap(a, b) {
    if (!a || !b) return false;
    if (a.begin == a.end || b.begin == b.end) return false; // one of the ranges is empty so can't overlap with anything
    if (a.end <= b.begin) return false;
    if (a.begin >= b.end) return false;
    return true;
}

export function filterEvent(elementSelector, handler) {
    return function(e) {
        for (var target = e.target; target && target !== this; target = target.parentNode) {
            if (target.matches(elementSelector)) {
                handler.call(target, e);
                break;
            }
        }
    }
}

export function empty(node) {
    while(node.firstChild) {
        node.removeChild(node.firstChild);
    }
}

export default {
    inAnimationFrame: function (f, queue) {
        if (inAnimFrame && !queue) {
            f();
        } else {
            animFrameQueue.push(f);
            if (!animFrameRequested) {
                animFrameRequested = true;
                requestAnimationFrame(this.handleAnimationFrames.bind(this));
            }
        }
    },

    handleAnimationFrames: function () {
        inAnimFrame = true;
        try {
            while (animFrameQueue.length) {
                animFrameQueue.pop()();
            }
        } finally {
            inAnimFrame = false;
            animFrameRequested = false;
        }
    },

    findInArray: function (array, selector) {
        for (var x = 0, l = array.length; x < l; x++) {
            if (selector(array[x], x)) return x;
        }
        return -1;
    },

    elementFromPoint: function (x, y, selector) {
        var elements = $(selector);
        for (var i = elements.length - 1; i >= 0; i--) {
            var e = $(elements.get(i)), o = e.offset();
            if (x >= o.left && y >= o.top && x < o.left + e.outerWidth() && y < o.top + e.outerHeight()) {
                return e;
            }
        }
    },

    cancelEvent: function (event) {
        event.stopPropagation();
        event.stopImmediatePropagation();
        event.preventDefault();
    },

    passthrough: function (target, delegate, functions) {
        for (var x = 0, l = functions.length; x < l; x++) {
            if (typeof delegate[functions[x]] == 'function') {
                target[functions[x]] = delegate[functions[x]].bind(delegate);
            }
        }
    },

    findRanges: findRanges,

    getValue: getValue,
    setValue: setValue,

    createElement: createElement,

    normalizeOptions: normalizeOptions,

    Evented: Evented,

    SubscriptionQueue: SubscriptionQueue,

    notNull: function (n) {
        return n != null;
    },

    map: function (input, func) {
        if (typeof input.then === 'function') {
            return input.then(func);
        } else {
            return func(input);
        }
    },

    diff: calculateDifference,

    incrementalUpdate: incrementalUpdate,

    addSingleUseEventListener: addSingleUseEventListener,

    offset: offset,

    overlap: overlap,

    debounce: function (func, period) {
        var timer;

        return function () {
            var args = arguments;
            var self = this;
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(function () {
                func.apply(self, args);
            }, period);
        }
    }
}
