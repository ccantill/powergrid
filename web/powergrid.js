import vein from "./vein.js";
import utils, {createElement, empty, Evented} from "./utils.js";
import translations from "./translations.js";

/**
 * @typedef PowerGridOptions
 * @type {object}
 * @property {number} virtualScrollingExcess - The number of extra rows to render on each side (top/bottom) of the viewport. A higher value results in less flickering during scrolling, but also higher memory usage and longer rendering times.
 * @property {number} frozenRowsTop - Number of rows at the top of the grid that should not scroll (i.e. header)
 * @property {number} frozenRowsBottom - Number of rows at the bottom of the grid that should not scroll (i.e. footer)
 * @property {number} frozenColumnsLeft - Number of columns on the left side of the grid that should not scroll
 * @property {number} frozenColumnsRight - Number of columns on the right side of the grid that should not scroll
 * @property {boolean} fullWidth - If true, the last column will stretch to fill the remaining space
 * @property {number} rowHeight - Default height of each row in pixels. Can be overridden in extensions on a per row basis.
 * @property {object} extensions - Object listing which extensions to load and their options
 */

/**
 * @typedef CellByRowIdAndColumnKey
 * @property {string} row id
 * @property {string} column key
 */

const defaultOptions = {
    virtualScrollingExcess: 10, // defines the number of extra rows to render on each side (top/bottom) of the viewport. This reduces flickering when scrolling.
    frozenRowsTop: 0,
    frozenRowsBottom: 0,
    frozenColumnsLeft: 0,
    frozenColumnsRight: 0,
    fullWidth: true,
    rowHeight: 31
};

const columnDefaults = {
    width: 100
};

let sequence = 0;

const debug = true;

function determineScrollBarSize() {
    // Creates a dummy div just to measure the scrollbar sizes, then deletes it when it's no longer necessary.
    const filler = utils.createElement("div", {
        style: "width:100%; height: 100%;"
    })
    const dummy = utils.createElement("div", {
            style: "overflow: scroll; width: 100px; height: 100px; visibility: hidden; opacity: 0"
        },
        [
            filler
        ]);
    document.body.appendChild(dummy);

    const size = {
        height: dummy.offsetHeight - filler.offsetHeight,
        width: dummy.offsetWidth - filler.offsetWidth
    }

    document.body.removeChild(dummy);

    return size;
}

let scrollBarSize = determineScrollBarSize();

//adjust the margin to compensate for the scrollbar
if (vein) {
    vein.inject('.pg-rowgroup', {'width': "calc(100% - " + scrollBarSize.width + "px)"});
    vein.inject('.pg-rowgroup.pg-footer', {'bottom': scrollBarSize.width + "px"});
}

function elementWithClasses(tagname, classes) {
    const el = document.createElement(tagname);
    if (classes) {
        el.className = classes;
    }
    return el;
}

function nonFalse(e) {
    return e !== false;
}

/**
 * Creates a new PowerGrid.
 * @module PowerGrid
 * @param {HTMLElement} target - the DOM element that should contain the new grid
 * @param {PowerGridOptions} options - the options to use in the grid
 * @constructor
 */
class PowerGrid extends Evented {

    constructor(target, options) {
        super();
        this.options = {
            ...defaultOptions,
            ...options,
            columns: this.applyColumnDefaults(options.columns)
        };
        this.target = target;

        this.dataSource = options.dataSource;

        if (target === false) return;

        this.promise = new Promise((resolve, reject) => {
            this.beginInit(resolve);
        });

        this.id = target.getAttribute('id');
    }

    /**
     * Queues the callback to invoke when the grid is ready
     * @param {function} callback - the callback to invoke when the grid is ready
     */
    then(callback) {
        return this.promise.then(callback);
    }

    applyColumnDefaults(columns) {
        return columns.map((column, index) => ({
            ...columnDefaults,
            key: index,
            ...column
        }));
    }

    /**
     * Begins the initialisation of the grid and invokes the given callback when ready
     * @private
     * @param callback
     */
    beginInit(callback) {
        if (this.options.extensions) {
            this.loadExtensions((pluginList, plugins) => {
                pluginList = this.sortByLoadOrder(pluginList, plugins);

                pluginList.forEach(key => {
                    console.info("Initing extension " + key);
                    const p = plugins[key];
                    try {
                        if (typeof p === 'function') {
                            p(this, this.options.extensions[key]);
                        } else if (typeof p.init === 'function') {
                            p.init(this, this.options.extensions[key]);
                        }
                    } catch (e) {
                        console.error("Error initializing extension " + key);
                        console.error(e);
                        throw e;
                    }
                });

                this.init();
                callback();
            });
        } else {
            this.init();
            callback();
        }
    }

    /**
     * Recursively load extensions and their dependencies
     * @private
     * @param callback
     * @param keys
     * @param plugins
     * @param pluginList
     */
    async loadExtensions(callback, keys, plugins, pluginList) {
        const grid = this;
        if (arguments.length < 4) {
            keys = Object.keys(this.options.extensions);
            plugins = {};
            pluginList = [];
        }

        const pluginArr = await Promise.all(keys.map(k => import((`./extensions/${k}.js`))));

        const newkeys = [];
        let i = 0;
        const n = keys.length;
        for (; i < n; i++) {
            const key = keys[i];
            const plugin = pluginArr[i].default;
            plugins[key] = plugin;
            pluginList.push(key);

            const reqs = plugin.requires;
            if (reqs) {
                for (let req in reqs) {
                    if (!grid.options.extensions[req]) {
                        newkeys.push(req);
                    }

                    if (!grid.options.extensions[req] || grid.options.extensions[req] === true) {
                        grid.options.extensions[req] = reqs[req];
                    } else {
                        $.extend(true, grid.options.extensions[req], reqs[req]);
                    }
                }
            }
        }

        if (newkeys.length) {
            await grid.loadExtensions(callback, newkeys, plugins, pluginList);
        } else {
            callback(pluginList, plugins);
        }
    }

    sortByLoadOrder(pluginList, plugins) {
        const sorted = [], added = {};

        function add(key) {
            if (plugins[key] !== undefined && added[key] === undefined) {
                if (plugins[key].loadFirst) {
                    plugins[key].loadFirst.forEach(add);
                }
                sorted.push(key);
                added[key] = true;
            }
        }

        pluginList.forEach(add);

        return sorted;
    }

    initLoadingIndicator() {
        this.target.classList.add("pg-loading");
    }

    elementId() {
        let id = this.target.getAttribute('id');
        if (!id) {
            id = "powergrid-" + (sequence++);
            this.target.setAttribute('id', id);
        }
        return id;
    }

    /**
     * Initializes the grid elements and event listeners
     * @private
     */
    init() {
        const self = this;
        this.baseSelector = "#" + this.elementId();
        const container = this.container = createElement("div", {class: "powergrid"});
        const columnheadercontainer = this.columnheadercontainer = createElement("div", {class: "pg-columnheaders"});
        const headercontainer = this.headercontainer = this.options.frozenRowsTop ? createElement("div", {class: "pg-rowgroup pg-header"}) : undefined;
        const scrollingcontainer = this.scrollingcontainer = createElement("div", {class: 'pg-rowgroup pg-scrolling'});
        const footercontainer = this.footercontainer = this.options.frozenRowsBottom ? createElement("div", {class: 'pg-rowgroup pg-footer'}) : undefined;
        const scroller = this.scroller = createElement("div", {class: 'pg-scroller'});
        const scrollFiller = this.scrollFiller = createElement("div", {class: 'pg-scroller-filler'});

        if (this.options.fullWidth) {
            container.classList.add("pg-full-width");
        }

        if (this.options.autoResize) {
            container.classList.add("pg-autoresize");
        }

        const hiddenColumns = this.loadSetting("hidden");
        if (hiddenColumns) {
            this._hideColumns(hiddenColumns);
        }

        this.fixedLeft = [];
        this.fixedRight = [];
        this.middleScrollers = [];

        this.columnheadergroup = this.createRowGroup(columnheadercontainer);
        this.headergroup = headercontainer && this.createRowGroup(headercontainer);
        this.scrollinggroup = this.createRowGroup(scrollingcontainer);
        this.footergroup = footercontainer && this.createRowGroup(footercontainer);

        this.renderColumnHeaderContents(this.columnheadergroup);

        container.appendChild(scroller).appendChild(scrollFiller);
        container.appendChild(scrollingcontainer);
        container.appendChild(columnheadercontainer);
        container.appendChild(headercontainer);
        container.appendChild(footercontainer);

        this.queueAdjustColumnPositions();

        this.target.appendChild(container);

        scroller.addEventListener('scroll', function (evt) {
            self.syncScroll(this, evt);
        });

        if (this.dataSource.isReady()) {
            if (!this.isInited) {
                this.isInited = true;
                this.trigger('inited', this);
            }

            this.resetDataSubscriptions();

            this.trigger('dataloaded');
            utils.inAnimationFrame(() => {
                this.renderData();
                this.trigger('viewchanged');
                this.target.classList.remove("pg-loading");
            });
        } else {
            this.initLoadingIndicator();
        }

        this.dataSource.on("dataloaded", data => {
            if (!this.isInited) {
                this.isInited = true;
                this.trigger('inited', this);
            }

            this.resetDataSubscriptions();

            this.trigger('dataloaded', data);
            utils.inAnimationFrame(() => {
                this.renderData();

                this.queueAfterRender(() => {
                    this.trigger('viewchanged');
                    this.target.classList.remove("pg-loading");
                });
            });
        });

        this.dataSource.on("rowsremoved", data => {
            this._removeRows(data.start, data.end);

            this.queueUpdateViewport();
            this.queueAdjustHeights();
            this.queueAfterRender(() => {
                this.trigger('rowsremoved', data);
                this.trigger('viewchanged');
            });
        });

        this.dataSource.on("rowsadded", data => {
            this._addRows(data.start, data.end);

            this.queueUpdateViewport();
            this.queueAdjustHeights();

            this.queueAfterRender(() => {
                this.trigger('rowsadded', data);
                this.trigger('viewchanged');
            });
        });

        this.dataSource.on("datachanged", data => {
            utils.inAnimationFrame(() => {
                if (data.values) {
                    this.updateCellValues(data.values);
                    this.trigger('change');
                }
                if (data.rows) {
                    this.updateRows(data.rows);
                    this.trigger('change');
                }
                this.trigger('datachanged', data);
                this.trigger('viewchanged');
            });
        });

        this.initScrollEvents();
    }

    /**
     * Invokes the given callback immediately if the grid is ready, or queues the callback to be invoked
     * as soon as the grid is ready.
     * @deprecated see {@link PowerGrid#then}
     * @param {function} callback - The callback to invoke.
     */
    ready(callback) {
        if (this.isInited) callback.apply(this, [this]);
        else this.on('inited', callback.bind(this, this));
    }

    /**
     * Remove the grid from the DOM and clean up.
     */
    destroy() {
        this.target.empty();
    }

    /**
     * Set up scroll event handler
     * @private
     */
    initScrollEvents() {
        const self = this;
        this.target.addEventListener("mousewheel", evt => {
            const dX = evt.deltaX, dY = evt.deltaY,
                dM = evt.deltaMode;
            let ddX, ddY;
            switch (dM) {
                case 0:
                    ddX = ddY = 1;
                    break;
                case 1:
                    ddX = ddY = self.rowHeight(0);
                    break;
                case 2:
                    ddX = self.pageHeight();
                    ddY = self.pageWidth();
                    break;
            }

            if (self.scrollBy(dX * ddX, dY * ddY)) {
                evt.preventDefault();
            }
        });

        this.initTouchScrollEvents();
    }

    /**
     * Set up touch event handler. This mimics inertial touch scrolling on touch devices.
     * @private
     */
    initTouchScrollEvents() {
        // sets up touch scrolling
        const self = this;
        let tracking = false, // keep tracking of whether we're currently tracking touch or not
            lastX, lastY;
        const timeUnit = 100, // 100ms
            inertialCutOff = 0.001, // minimum speed for inertial scrolling before cutoff
            inertia = 0.998;
        let // inertia for inertial scrolling (higher means longer scrolling, 1 = infinite (frictionless) scrolling, 0 = no inertial scrolling)
            // scroll speed is multiplied by this factor for each millisecond that passes

            eventQueue = []; // keep track of last 100ms of events to determine drag speed

        function pruneEventQueue() {
            // remove all eventQueue entries older than <timeUnit> milliseconds
            const t = eventQueue[0].t;
            for (var x = 1, l = eventQueue.length; x < l; x++) {
                if ((t - eventQueue[x].t) > timeUnit) break;
            }
            eventQueue = eventQueue.slice(0, x);
        }

        function startInertialScroll(speedX, speedY) {
            let previousTime = new Date().getTime();

            const scrollPosition = self.getScrollPosition();

            function draw() {
                if (tracking) return; // if tracking a new touch thing, stop inertial scrolling

                const t = new Date().getTime();
                const frameDuration = t - previousTime;
                previousTime = t;

                const r = Math.pow(inertia, frameDuration);
                speedX = speedX * r; // adjust speed according to drag
                speedY = speedY * r;

                if (Math.abs(speedX) >= inertialCutOff && Math.abs(speedY) >= inertialCutOff) {
                    // not doing relative scrolling because that looses a lot of precision
                    scrollPosition.left += speedX * frameDuration;
                    scrollPosition.top += speedY * frameDuration;
                    self.scrollTo(Math.round(scrollPosition.left), Math.round(scrollPosition.top));

                    // request next frame.
                    requestAnimationFrame(draw);
                }
            }

            utils.inAnimationFrame(draw);
        }

        this.target.addEventListener("touchstart", startevent => {
            // user touches screen, so we may have to start scrolling
            tracking = true;
            lastX = startevent.touches[0].pageX, lastY = startevent.touches[0].pageY;
        });

        this.target.addEventListener("touchmove", dragevent => {
            if (tracking) { // probably a pointless test since we shouldn't be getting a touchmove event unless we got a touchstart first anyway, but still
                const newX = dragevent.touches[0].pageX,
                    newY = dragevent.touches[0].pageY;

                const dX = lastX - newX, dY = lastY - newY;

                const e = {
                    x: dX,
                    y: dY,
                    t: new Date().getTime()
                };

                eventQueue.unshift(e);
                pruneEventQueue();

                lastX = newX;
                lastY = newY;

                self.scrollBy(dX, dY);

                dragevent.preventDefault();
            }
        });

        this.target.addEventListener("touchend", endevent => {
            tracking = false;

            if (!eventQueue.length) return;

            const timeSinceLastEvent = (new Date().getTime()) - eventQueue[0].t;
            if (timeSinceLastEvent < timeUnit) {
                const delta = eventQueue.reduce((a, b) => {
                    a.dX += b.x;
                    a.dY += b.y;
                    return a;
                }, {dX: 0, dY: 0});

                const timeBetween = eventQueue[0].t - eventQueue[eventQueue.length - 1].t;

                startInertialScroll(delta.dX / timeBetween, delta.dY / timeBetween);
            }

            eventQueue = [];
        });
    }

    /**
     * Creates a row group in the given container. There are three row groups in the grid: top, scrolling (center), and bottom.
     * @private
     * @param container
     * @returns {{left: boolean|*|jQuery|HTMLElement, scrolling: *|jQuery|HTMLElement, right: boolean|*|jQuery|HTMLElement, all: *|jQuery|HTMLElement}}
     */
    createRowGroup(container) {
        const fixedPartLeft = this.options.frozenColumnsLeft > 0 && createElement("div", {class: 'pg-container pg-fixed pg-left'});
        const fixedPartRight = this.options.frozenColumnsRight > 0 && createElement("div", {class: 'pg-container pg-fixed pg-right'});
        const scrollingPart = createElement("div", {class: 'pg-container pg-scrolling'});

        this.fixedLeft = this.fixedLeft.concat([fixedPartLeft]);
        this.fixedRight = this.fixedRight.concat([fixedPartRight]);
        this.middleScrollers = this.middleScrollers.concat([scrollingPart]);

        let all = [];
        if (fixedPartLeft) all = all.concat(fixedPartLeft);
        if (scrollingPart) all = all.concat(scrollingPart);
        if (fixedPartRight) all = all.concat(fixedPartRight);

        container.appendChild(scrollingPart);
        container.appendChild(fixedPartLeft);
        container.appendChild(fixedPartRight);

        return {
            left: fixedPartLeft,
            scrolling: scrollingPart,
            right: fixedPartRight,
            all: all
        };
    }

    /**
     * Because data requests are asynchronous, it's possible a data request returns with stale data. This method
     * invalidates all ongoing data requests so no stale data is handled by methods that have been properly queued
     * in the dataSubscriptions SubscriptionQueue.
     */
    resetDataSubscriptions() {
        if (this.dataSubscriptions) {
            this.dataSubscriptions.cancel();
        }
        this.dataSubscriptions = new utils.SubscriptionQueue();
    }

    /**
     * Resets the grid contents.
     * @private
     */
    renderData() {
        const self = this;

        const recordCount = Promise.resolve(this.dataSource.recordCount()).then(this.dataSubscriptions.queue(recordCount => {
            self.headergroup && self.headergroup.all.forEach(empty);
            self.footergroup && self.footergroup.all.forEach(empty);

            self.recordCount = recordCount;

            self.resetDataSubscriptions(); // cancel any requests that still assume the old recordCount

            /**
             * The working set contains all rows that are currently in the grid (though not necessarily in view) and have
             * been loaded through 'getData'. If the dataset changes, this needs to be kept up to date and the indexes in
             * the working set should always match the index in the grid for any given row.
             */
            self.workingSet = new Array(recordCount);

            self.allRowsDisposed();

            self.setViewport({
                begin: 0,
                end: 0
            });

            self.headergroup && self.renderRowGroupContents(0, self.options.frozenRowsTop, self.headergroup);
            self.footergroup && self.renderRowGroupContents(recordCount - self.options.frozenRowsBottom, recordCount, self.footergroup);

            self.queueUpdateViewport();
            self.queueAdjustHeights();
            self.queueAfterRender(() => {
                self.trigger("datarendered");
            });
        }));
    }

    /**
     * Returns a row by index from the working set, or undefined if the row wasn't loaded yet.
     * @param {number} index
     * @returns {object}
     */
    getRow(index) {
        const workingSetElement = this.workingSet[index];
        return workingSetElement && workingSetElement.record;
    }

    /**
     * Returns the index of the given row. Only works if it's in the working set (i.e. the row has been loaded in the grid).
     * @param {object} row
     * @returns {number}
     */
    indexOfRow(row) {
        return this.workingSet.findIndex(r => r && (r.record === row));
    }

    /**
     * Returns the current number of records known to be in the datasource, or throws an Exception if the amount isn't known.
     * @returns {number}
     */
    getRecordCount() {
        if (this.recordCount === undefined) {
            throw "Record count currently unknown."
        }
        return this.recordCount;
    }

    /**
     * Calls the dataSource's getData, updates the working set and returns a Promise of the results.
     * @param start
     * @param end
     * @returns {Promise<object[]>|object[]}
     */
    getData(start, end) {
        const self = this;
        const data = this.dataSource.getData(start, end);

        let workingDataSubset;
        if (start !== undefined) {
            workingDataSubset = new Array((end || this.getRecordCount()) - start);
            for (var x = start; x < end; x++) {
                workingDataSubset[x - start] = self.workingSet[x] = {};
            }
        }

        function processData(result) {
            let x = 0;
            const l = result.length;
            for (; x < l; x++) {
                workingDataSubset[x].record = result[x];
            }
            return result;
        }

        if (Array.isArray(data)) {
            return processData(data);
        } else {
            return data.then(processData);
        }
    }

    /**
     * Calls the dataSource's getData, updates the working set and immediately returns the records. This
     * only works if the dataSource is synchronous (i.e. getData returns an array, not a Promise), and throws
     * an exception otherwise.
     * @param start
     * @param end
     */
    getDataSync(start, end) {
        const result = this.dataSource.getData(start, end);
        if (Array.isArray(result)) {
            let x = 0;
            const l = result.length;
            for (; x < l; x++) {
                this.workingSet[(start || 0) + x] = {record: result[x]};
            }
            return result;
        } else {
            throw new Error("This method requires a synchronous datasource.");
        }
    }

    /**
     * Renders the column headers to the given rowgroup
     * @private
     * @param rowgroup
     */
    renderColumnHeaderContents(rowgroup) {
        const rowFixedPartLeft = rowgroup.left && createElement("div", {class: 'pg-row pg-fixed'}),
            rowScrollingPart = rowgroup.scrolling && createElement("div", {class: 'pg-row pg-scrolling'}),
            rowFixedPartRight = rowgroup.right && createElement("div", {class: 'pg-row pg-fixed'});
        let rowParts = [];

        if (rowgroup.left) rowgroup.left.append(rowFixedPartLeft);
        if (rowgroup.scrolling) rowgroup.scrolling.append(rowScrollingPart);
        if (rowgroup.right) rowgroup.right.append(rowFixedPartRight);

        if (rowFixedPartLeft) rowParts = rowParts.concat(rowFixedPartLeft);
        if (rowScrollingPart) rowParts = rowParts.concat(rowScrollingPart);
        if (rowFixedPartRight) rowParts = rowParts.concat(rowFixedPartRight);

        const columns = this.getVisibleColumns();
        for (let y = 0; y < columns.length; y++) {
            let cell;
            const column = columns[y];
            cell = this.renderHeaderCell(column, y);

            cell.classList.add("pg-column" + this.normalizeCssClass(column.key));
            cell.setAttribute("data-column-key", column.key);

            if (y < this.options.frozenColumnsLeft) {
                rowFixedPartLeft.append(cell);
            } else if (y > columns.length - this.options.frozenColumnsRight - 1) {
                rowFixedPartRight.append(cell);
            } else {
                rowScrollingPart.append(cell);
            }
        }
    }

    /**
     * Templates for row groups
     * @private
     */
    rowGroupTemplates = {
        fixed: elementWithClasses("div", "pg-row pg-fixed"),
        scrolling: elementWithClasses("div", "pg-row pg-scrolling")
    }

    /**
     * Render contents (indicated by a start and end index) for a given rowgroup, and insert them before or after
     * the given index.
     * @private
     * @param {number} start
     * @param {number} end
     * @param {object} rowgroup
     * @param {boolean} prepend
     * @param {index} atIndex
     */
    renderRowGroupContents(start, end, rowgroup, prepend, atIndex) {
        const self = this;

        if (atIndex == -1 && !prepend) {
            // we're inserting a row after -1, so basically prepend before anything else
            atIndex = undefined;
            prepend = true;
        }

        const method = atIndex === undefined ? (prepend === true ? 'prepend' : 'append') : (prepend === true ? 'before' : 'after');

        let targetLeft, targetMiddle, targetRight;

        if (atIndex === undefined) {
            targetLeft = rowgroup.left;
            targetMiddle = rowgroup.scrolling;
            targetRight = rowgroup.right;
        } else {
            targetLeft = rowgroup.left && rowgroup.left.querySelectorAll(":scope > .pg-row:eq(" + atIndex + ")");
            targetMiddle = rowgroup.scrolling && rowgroup.scrolling.querySelectorAll(":scope > .pg-row:eq(" + atIndex + ")");
            targetRight = rowgroup.right && rowgroup.right.querySelectorAll(":scope > .pg-row:eq(" + atIndex + ")");
        }

        const fragmentLeft = targetLeft && document.createDocumentFragment(),
            fragmentMiddle = targetMiddle && document.createDocumentFragment(),
            fragmentRight = targetRight && document.createDocumentFragment();

        const dataSubset = this.getData(start < 0 ? 0 : start, end);
        const rows = new Array(end - start);

        for (var x = start; x < end; x++) {
            var rowFixedPartLeft = targetLeft && this.rowGroupTemplates.fixed.cloneNode();
            var rowScrollingPart = targetMiddle && this.rowGroupTemplates.scrolling.cloneNode();
            var rowFixedPartRight = targetRight && this.rowGroupTemplates.fixed.cloneNode();
            var rowParts = [rowFixedPartLeft, rowScrollingPart, rowFixedPartRight].filter(nonFalse);

            rows[x] = {
                rowFixedPartLeft: rowFixedPartLeft,
                rowScrollingPart: rowScrollingPart,
                rowFixedPartRight: rowFixedPartRight
            };

            rowParts.forEach(e => {
                e.setAttribute("data-row-idx", x);
                e.style.height = self.rowHeight(x) + "px";
            });

            if (fragmentLeft) fragmentLeft.appendChild(rowFixedPartLeft);
            if (fragmentMiddle) fragmentMiddle.appendChild(rowScrollingPart);
            if (fragmentRight) fragmentRight.appendChild(rowFixedPartRight);
        }

        function populateRows(dataSubset) {
            let x = (end <= self.options.frozenRowsTop || start >= self.recordCount - self.options.frozenRowsBottom) ? start : Math.max(start, self.viewport.begin);
            const vpEnd = (end <= self.options.frozenRowsTop || start >= self.recordCount - self.options.frozenRowsBottom) ? end : Math.min(end, self.viewport.end);
            for (; x < vpEnd; x++) {
                const record = dataSubset[x - start],
                    row = rows[x],
                    rowFixedPartLeft = row.rowFixedPartLeft,
                    rowScrollingPart = row.rowScrollingPart,
                    rowFixedPartRight = row.rowFixedPartRight;

                const rowParts = [rowFixedPartLeft, rowScrollingPart, rowFixedPartRight].filter(nonFalse);

                self.renderRowToParts(record, x, rowFixedPartLeft, rowScrollingPart, rowFixedPartRight);
                self.afterRenderRow(record, x, rowParts);

                rowParts.forEach(e => {
                    e.setAttribute("data-row-id", record.id);
                });
            }
        }

        if (Array.isArray(dataSubset)) {
            populateRows(dataSubset);
        } else {
            // assume Promise<object[]>
            dataSubset.then(this.dataSubscriptions.queue(populateRows)).catch(error => {
                console.error(error);
            });
        }

        if (targetLeft) targetLeft[method](fragmentLeft);
        if (targetMiddle) targetMiddle[method](fragmentMiddle);
        if (targetRight) targetRight[method](fragmentRight);
    }

    /**
     * Do not invoke directly. Renders the cells for the given record to the rows parts; each row
     * can have three parts: the left fixed part, a middle scrolling part and a right fixed part.
     * @param {object} record - The record to render
     * @param {number} rowIdx - The index of the row
     * @param {HTMLElement} rowFixedPartLeft
     * @param {HTMLElement} rowScrollingPart
     * @param {HTMLElement} rowFixedPartRight
     */
    renderRowToParts(record, rowIdx, rowFixedPartLeft, rowScrollingPart, rowFixedPartRight) {
        const columns = this.getVisibleColumns();
        for (let y = 0; y < columns.length; y++) {
            let cell;
            const column = columns[y];
            cell = this.renderCell(record, column, rowIdx, y);
            this.afterCellRendered(record, column, cell);

            cell.className += " pg-column" + this.normalizeCssClass(column.key);
            cell.setAttribute("data-column-key", column.key);

            if (y < this.options.frozenColumnsLeft) {
                rowFixedPartLeft.appendChild(cell);
            } else if (y > columns.length - this.options.frozenColumnsRight - 1) {
                rowFixedPartRight.appendChild(cell);
            } else {
                rowScrollingPart.appendChild(cell);
            }
        }
    }

    /**
     * Invoked after a row is rendered to its parts.
     * @param {object} record - The record that was rendered
     * @param {number} rowIndex - The index of the row
     * @param {HTMLElement[]} rowParts - array containing the row parts (left, middle, right)
     */
    afterRenderRow(record, rowIndex, rowParts) {
    }

    /**
     * Remove the rows from start to end index.
     * @param start
     * @param end
     * @private
     */
    _removeRows(start, end) {
        if (end > this.recordCount || end < start) {
            throw "Index mismatch";
        }
        this.recordCount -= end - start;

        if (this.workingSet) {
            this.workingSet.splice(start, end - start);
        }

        const self = this;

        if (end <= this.viewport.begin) {
            // deleted rows come before the viewport, so adjust the viewport indexes and index attributes of rendered rows
            this.viewport.begin -= end - start;
            this.viewport.end -= end - start;
            this._incrementRowIndexes(start, start - end);

            if (debug) this.verify();
        } else if (end > this.viewport.begin && start < this.viewport.end) {
            // deleted block has overlap with current viewport, so remove currently rendered rows

            // find pg-row elements to remove. as gt and lt work within the result, first do 'lt' as 'gt' affect indeces
            // first build a selector
            let selector = ".pg-row";
            // then query all row containers with that selector
            this.scrollingcontainer.querySelectorAll(":scope >.pg-container").forEach((part,i) => {
                // and destroy the found row elements
                let children = part.querySelectorAll(":scope > " + selector);

                if (end < this.viewport.end) {
                    children = children.slice(0, end - this.viewport.begin);
                }
                if (start > this.viewport.begin) {
                    children = children.slice(start - this.viewport);
                }

                if (children.length !== Math.min(end, self.viewport.end) - Math.max(start, self.viewport.begin)) {
                    debugger;
                }
                self.destroyRows(children);
            });

            if (end < this.viewport.end) {
                // adjust the index attributes of the remaining rendered rows after the deleted block.
                this._incrementRowIndexes(start, start - end);
            }

            if (start < this.viewport.begin) {
                // deleted block covers start of viewport
                this.viewport.begin = start;
            }

            // the effective viewport will have shrunk, so adjust it
            if (end >= this.viewport.end) {
                this.viewport.end = Math.max(start, this.viewport.begin);
                if (debug) this.verify();
            } else {
                this.viewport.end -= end - start;
                if (debug) this.verify();
            }
        } else {
            if (debug) this.verify();
        }

        this.queueUpdateViewport();
    }

    /**
     * The current range of rows that should be rendered.
     * @returns {*|{begin, end}}
     */
    viewRange() {
        const self = this,
            start = this.options.frozenRowsTop,
            end = this.getRecordCount() - this.options.frozenRowsBottom,
            sPos = this.getScrollPosition(),
            sArea = this.getScrollAreaSize(),
            range = this.rowsInView(sPos.top, sPos.top + sArea.height, start, end);

        const begin = Math.max(start, range.begin - this.options.virtualScrollingExcess);
        range.begin = begin - (begin % 2); // maintain odd/even-ness of rows for styling purposes
        range.end = Math.min(end, range.end + this.options.virtualScrollingExcess);

        return range;
    }

    /**
     * Scroll the grid to the given row index
     * @param {number} rowIdx
     */
    scrollToCell(rowIdx) {
        const self = this,
            start = this.options.frozenRowsTop,
            end = this.getRecordCount() - this.options.frozenRowsBottom,
            sPos = this.getScrollPosition(),
            sArea = this.getScrollAreaSize(),
            range = this.rowsInView(sPos.top, sPos.top + sArea.height, start, end);
        let newScrollTop = sPos.top;
        const newScrollLeft = sPos.left;

        if ((!this.options.frozenRowsTop || rowIdx >= this.options.frozenRowsTop) &&
            (!this.options.frozenRowsBottom || rowIdx < this.getRecordCount() - this.options.frozenRowsBottom)) {

            // row is in scrolling part
            if (rowIdx <= range.begin || rowIdx >= range.end) {
                // row is outside viewport. we gotta scroll.
                newScrollTop = Math.max(0, this.rowHeight(start, rowIdx) - sArea.height / 2);
            }
        }

        this.scrollTo(newScrollLeft, newScrollTop);
    }

    /**
     * Update the column headers and widths, and optionally data
     * @param {boolean} renderData - true if the data should be rendered as well.
     */
    updateColumns(renderData) {
        if (renderData !== false) {
            this.renderData();
        }
        this.columnheadergroup.all.empty();
        this.renderColumnHeaderContents(this.columnheadergroup);
        this.queueAdjustColumnPositions(false);
    }

    /**
     * Hide the given columns
     * @param {string[]} keys - array of column keys to hide
     */
    hideColumns(keys) {
        this.saveSetting("hidden", keys);
        this._hideColumns(keys);
        this.updateColumns();
    }

    /**
     * Set the specific columns visibility
     * @param key
     * @param visibility
     */
    setColumnVisibility(key, visibility) {
        const column = this.getColumnForKey(key);
        column.hidden = !visibility;
        const keys = this.options.columns.filter(
            column => column.hidden).map(column => column.key);
        this.saveSetting("hidden", keys);
        this.updateColumns();
    }

    /**
     * Check if the given column is hidden
     * @param {object} column - Column object
     * @returns {boolean}
     */
    isColumnHidden(column) {
        return column.hidden || false
    }

    _hideColumns(keys) {
        this.options.columns.forEach(column => {
            column.hidden = keys.indexOf(column.key) > -1;
        });
    }

    /**
     * Increment the row index attributes on the row HTML elements.
     * @param {number} start - the index of the first row that should be updated. Only this row and rows after this one will be updated
     * @param {number} offset - value to increment the indexes by
     * @private
     */
    _incrementRowIndexes(start, offset) {
        this.container.find("> .pg-rowgroup > .pg-container > .pg-row").each((idx, row) => {
            var idx = parseInt(row.getAttribute('data-row-idx'));
            if (idx >= start) {
                row.setAttribute('data-row-idx', idx + offset);
            }
        });
    }

    /**
     * Handler for the 'rowsadded' event.
     * @param {number} start - The index of the first row that was added.
     * @param {number} end - The index of the last row that was added.
     * @private
     */
    _addRows(start, end) {
        if (start > this.recordCount) {
            throw "Index mismatch";
        }

        this.recordCount += end - start;

        if (this.workingSet) {
            // insert the appropriate amount of new empty entries in the workingSet
            this.workingSet = this.workingSet.slice(0, start).concat(new Array(end - start)).concat(this.workingSet.slice(start));
        }


        if (end >= this.viewport.begin && start < this.viewport.end) {
            // the new rows are within the current viewport, so add the new rows to the grid
            // excess rows in the viewport will be truncated in updateViewport

            // adding rows can have an effect on the viewport, so predict what the new viewport should be like
            const viewRange = this.viewRange();

            // overlap of the viewport and new datablock. The new viewport (viewRange) after inserting may be
            // larger than the current viewport, so take the new viewport into account
            const renderEnd = Math.min(Math.max(viewRange.end, this.viewport.end), end);
            const renderStart = Math.max(this.viewport.begin, start);
            const renderCount = renderEnd - renderStart;

            // if we're appending
            // and the last row that's appended's index + 1 is not equal the adjusted index of the insertion point row
            // so renderEnd != renderStart + end - start
            // then it's not contiguous
            if (renderEnd != renderStart + end - start) {
                // we're not rendering the last rows of the new data block, so we have to remove all rows starting from the insertion point
                const startIndexForDeletion = renderStart - this.viewport.begin;
                const self = this;
                let selector = ".pg-row";
                if (startIndexForDeletion > 0) {
                    selector += ":gt(" + (startIndexForDeletion - 1) + ")";
                }
                this.scrollinggroup.all.each((i, part) => {
                    const rows = part.querySelectorAll(":scope " + selector);
                    if (debug && rows.length != self.viewport.end - renderStart) {
                        // our selector is returning more rows than we're expecting
                        debugger;
                    }
                    self.destroyRows(rows);
                });
                // adjust the viewport
                this.viewport.end = renderStart;
            }

            // update the data-row-idx attributes
            this._incrementRowIndexes(start, end - start);
            this.viewport.end += renderCount;

            if (renderEnd == this.viewport.end) { // if this block of data comes right at the end of the viewport
                // append rows to the end
                this.renderRowGroupContents(renderStart, renderEnd, this.scrollinggroup, false);
            } else {
                // otherwise insert them before the correct index
                this.renderRowGroupContents(renderStart, renderEnd, this.scrollinggroup, true, renderStart - this.viewport.begin);
            }

            if (debug) this.verify();
        } else if (end < this.viewport.begin) {
            // the new rows are inserted before the current viewport, so shift the indexes of the viewport and rendered rows
            this.viewport.end += end - start;
            this.viewport.begin += end - start;
            this._incrementRowIndexes(start, end - start);

            if (debug) this.verify();
        } else {
            if (debug) this.verify();
        }

        // schedule a viewport update
        this.queueUpdateViewport();
    }

    /**
     * Invoked when the viewport has changed.
     * @param {boolean} renderExcess - if true, immediately render excess rows. If false, this is scheduled for a later time.
     */
    updateViewportImmediate(renderExcess) {
        const start = this.options.frozenRowsTop,
            end = this.getRecordCount() - this.options.frozenRowsBottom,
            sPos = this.getScrollPosition(),
            sArea = this.getScrollAreaSize(),
            rowsInView = this.rowsInView(sPos.top, sPos.top + sArea.height, start, end),
            rowsInViewWithExcess = {
                begin: Math.max(start, rowsInView.begin - this.options.virtualScrollingExcess),
                end: Math.min(end, rowsInView.end + this.options.virtualScrollingExcess)
            };
        let range;

        // updateViewport does a two-pass refresh of the viewport. In the first pass, it will render only the rows
        // that are necessary to fill the current viewport. The second pass (renderExcess == true) is called at the
        // next available timeslot, and adds the excess rows. This is to ensure that the time before the user sees
        // the updated viewport is as short as possible, and the user does not have to wait for rows to render
        // that he's not going to see anyway.
        if (!renderExcess) {
            // First pass, render as little as possible.
            if (utils.overlap(this.viewport, rowsInViewWithExcess)) {
                // the target viewport is adjacent to the current one, so we'll take the union of the current
                // viewport with what is going to be visible to the user. That means no rows are being removed
                // from the DOM just yet, only rows are being added (either rows that are going to be visible,
                // or excess rows that are required in the DOM to keep the viewport contiguous).
                range = {
                    begin: Math.min(rowsInView.begin, this.viewport.begin),
                    end: Math.max(rowsInView.end, this.viewport.end)
                }
            } else {
                // there is no overlap of the current viewport with the target viewport, so just drop the current
                // viewport alltogether.
                range = rowsInView;
            }
        } else {
            range = rowsInViewWithExcess;
        }

        this.setViewport(range);

        if (!renderExcess) {
            (window.clearImmediate) && window.clearImmediate(this._updateViewportImmediate);
            this._updateViewportImmediate = (window.setImmediate || requestAnimationFrame)(this.updateViewportImmediate.bind(this, true));
        }
    }

    updateViewport = utils.debounce(function () {
        requestAnimationFrame(this.updateViewportImmediate.bind(this));
    }, 100)

    /**
     * Invoked when the viewport needs to change (e.g. when scrolling)
     * @param {Range} range
     */
    setViewport(range) {
        const self = this,
            start = this.options.frozenRowsTop,
            end = this.getRecordCount() - this.options.frozenRowsBottom,
            group = this.scrollinggroup,
            allParts = group.all,
            previousViewport = this.viewport;

        this.viewport = range;

        if (!this.previousViewport || range.begin != previousViewport.begin || range.end != previousViewport.end) {
            const leadingHeight = this.rowHeight(start, range.begin),
                trailingHeight = this.rowHeight(range.end, end);

            if (utils.overlap(range, previousViewport)) {
                if (range.begin < previousViewport.begin) {
                    // have to add rows to beginning
                    this.renderRowGroupContents(Math.max(start, range.begin), Math.min(range.end, previousViewport.begin), this.scrollinggroup, true);
                } else if (range.begin > previousViewport.begin) {
                    // have to remove rows from beginning
                    allParts.forEach((part) => {
                        self.destroyRows(Array.from(part.querySelectorAll(':scope > .pg-row')).slice(0, range.begin - previousViewport.begin));
                    });
                }

                if (range.end < previousViewport.end && range.end > previousViewport.begin) {
                    // have to remove rows from end
                    allParts.forEach((part) => {
                        self.destroyRows(Array.from(part.querySelectorAll(':scope > .pg-row')).slice(range.end - range.begin));
                    });
                } else if (range.end > previousViewport.end) {
                    // have to add rows to end
                    this.renderRowGroupContents(Math.max(previousViewport.end, range.begin), Math.min(range.end, end), this.scrollinggroup, false);
                }
            } else {
                // no overlap, just clear the entire thing and rebuild
                allParts.forEach(empty);
                this.allRowsDisposed();

                const scrollingStart = Math.max(start, range.begin);
                const scrollingEnd = Math.min(range.end, end);

                if (scrollingEnd > scrollingStart) {
                    this.renderRowGroupContents(scrollingStart, scrollingEnd, this.scrollinggroup, false);
                }
            }

            allParts.forEach(e => {
                e.style.paddingTop = leadingHeight + 'px';
                e.style.paddingBottom = trailingHeight + 'px';
            });
        }

        if (debug) this.verify();
    }

    _updateStyle(temporary, selector, style) {
        if (temporary === true) {
            this.target.querySelectorAll(selector).forEach(e => {
                for(let x in style) {
                    e.style[x] = style[x];
                }
            });
        } else {
            if (temporary === false) {
                // means we explicitly invoke this after temporary changes, so reset the temporary changes first
                this.target.querySelectorAll(selector).forEach(e => {
                    for(let x in style) {
                        e.style[x] = "";
                    }
                })
            }
            vein.inject(this.baseSelector + " " + selector, style);
        }
    }

    /**
     * Update column widths.
     * @param {boolean} temporary - pass true for performance when a series of changes are expected, but always finalize by passing false.
     */
    adjustWidths(temporary) {
        // Adjusts the widths of onscreen parts. Triggered during init, or when changing column specifications
        const columns = this.options.columns;
        let x = 0;
        const l = columns.length;
        for (; x < l; x++) {
            const column = columns[x];
            const w = this.columnWidth(x);

            let fullWidth = this.options.fullWidth && x < this.options.columns.length - this.options.frozenColumnsRight;
            for (let xx = x + 1; fullWidth && xx < this.options.columns.length - this.options.frozenColumnsRight; xx++) {
                if (!this.isColumnHidden(this.options.columns[xx])) {
                    fullWidth = false;
                }
            }

            if (fullWidth) {
                this._updateStyle(temporary, ".pg-column" + this.normalizeCssClass(column.key), {
                    "width": "auto",
                    "min-width": w + "px",
                    "right": "0"
                });
            } else {
                this._updateStyle(temporary, ".pg-column" + this.normalizeCssClass(column.key), {
                    "width": w + "px",
                    "right": "auto"
                });
            }
        }

        const leadingWidth = this.columnWidth(0, this.options.frozenColumnsLeft);
        const middleWidth = this.columnWidth(this.options.frozenColumnsLeft, this.options.columns.length - this.options.frozenColumnsRight);
        const trailingWidth = this.columnWidth(this.options.columns.length - this.options.frozenColumnsRight, this.options.columns.length);

        this.fixedLeft.forEach(e => e.style.width = leadingWidth + "px");
        this.fixedRight.forEach(e => e.style.width = trailingWidth + "px");
        if (this.columnheadergroup.right) this.columnheadergroup.right.style.width = (trailingWidth + scrollBarSize.width) + "px";

        const minWidth = 'calc(100% - ' + leadingWidth + 'px - ' + trailingWidth + 'px)';
        this.middleScrollers.forEach(e => {
            e.style.left = leadingWidth + "px";
            e.style.width = middleWidth + "px";
            e.style.minWidth = minWidth
        });

        this.scrollFiller.style.width = (leadingWidth + middleWidth + trailingWidth) + "px";

        if (this.options.autoResize) {
            this.container.style.width = this.columnWidth(0, this.options.columns.length) + "px";
        }
    }

    /**
     * Adjusts the heights of onscreen parts. Invoked during init, or when changing row heights and such.
     */
    adjustHeights() {
        const columnHeaderHeight = this.headerContainerHeight();
        const headerHeight = this.rowHeight(0, this.options.frozenRowsTop);
        const footerHeight = this.rowHeight(this.getRecordCount() - this.options.frozenRowsBottom, this.getRecordCount());
        this.columnheadercontainer.style.height = (columnHeaderHeight) + "px";
        this.columnheadergroup.all.forEach(e => e.style.height = (this.headerHeight()) + "px");

        if(this.headercontainer) {
            this.headercontainer.style.height = (headerHeight) + "px";
            this.headercontainer.style.top = (columnHeaderHeight) + "px";
        }
        if(this.footercontainer) {
            this.footercontainer.style.height = (footerHeight) + "px";
        }

        this.scrollingcontainer.style.top = (columnHeaderHeight + headerHeight) + "px";
        this.scrollingcontainer.style.bottom = (footerHeight + (this.options.autoResize ? 0 : scrollBarSize.height)) + "px";

        this.scroller.style.top = columnHeaderHeight + "px";
        this.scrollFiller.style.height = this.rowHeight(0, this.getRecordCount()) + this.scroller.offsetHeight - this.scrollingcontainer.offsetHeight + "px";

        if (this.options.autoResize) {
            this.container.style.height = (this.rowHeight(0, this.getRecordCount()) + columnHeaderHeight) + "px";
        }
    }

    /**
     * Returns the height of the header container. In a default implementation, this is the same as {@link PowerGrid#headerHeight}.
     * Extensions can however add other elements to the header container, and override this method.
     * @returns {number} The height in pixels
     */
    headerContainerHeight() {
        return this.headerHeight();
    }

    /**
     * Returns the height of the header contents
     * @returns {number} The height in pixels.
     */
    headerHeight() {
        return Math.max(...Array.from(this.target.querySelectorAll(".pg-columnheader span")).map(e => e.offsetHeight));
    }

    /**
     * Adjust the grid when the column order has changed.
     * @param {boolean} temporary - pass true for performance when a series of changes are expected, but always finalize by passing false.
     * @returns {number[]} the positions of each column in pixels within their parts.
     */
    adjustColumnPositions(temporary) {
        // Repositions all columns horizontal positions
        const columns = this.options.columns;
        let pos = 0;
        const positions = new Array(this.options.length);
        let x = 0;
        const l = columns.length;
        for (; x < l; x++) {
            const column = columns[x];
            if (x === this.options.frozenColumnsLeft || l - x === this.options.frozenColumnsRight) {
                pos = 0;
            }
            positions[x] = pos;
            this._updateStyle(temporary, ".pg-column" + this.normalizeCssClass(column.key), {left: pos + "px"});
            column.offsetLeft = pos;

            pos += this.columnWidth(x);
        }

        this.adjustWidths(temporary);

        return positions;
    }

    /**
     * Queues a render update and returns an object on which render queue flags can be set.
     * @returns {object}
     */
    queueRenderUpdate() {
        const self = this;
        if (this.renderQueue == undefined) {
            this.renderQueue = {callbacks: []};
            utils.inAnimationFrame(() => {
                self.processRenderQueue(self.renderQueue);

                self.renderQueue.callbacks.forEach(f => {
                    f.apply(self);
                });

                self.renderQueue = undefined;
            }, true);
        }

        return this.renderQueue;
    }

    /**
     * Process the render queue
     * @private
     * @param queue
     */
    processRenderQueue(queue) {
        if (queue.syncScroll) {
            this.syncScroll(true);
        }

        if (queue.updateViewport) {
            this.updateViewport();
        }

        if (queue.adjustColumnPositions) {
            this.adjustColumnPositions(queue.columnPositionsTemporary);
        }

        if (queue.adjustHeights) {
            this.adjustHeights();
        }
    }

    /**
     * Queue an adjustment of column positions.
     * @param temporary - see {@link PowerGrid#adjustColumnPositions}
     */
    queueAdjustColumnPositions(temporary) {
        const q = this.queueRenderUpdate();
        if (!temporary) {
            q.columnPositionsTemporary = false;
        } else if (q.columnPositionsTemporary === undefined) {
            q.columnPositionsTemporary = temporary;
        }
        q.adjustColumnPositions = true;
    }

    /**
     * Queue a height adjustment
     */
    queueAdjustHeights() {
        this.queueRenderUpdate().adjustHeights = true;
    }

    /**
     * Queue a viewport adjustment
     */
    queueUpdateViewport() {
        this.queueRenderUpdate().updateViewport = true;
    }

    /**
     * Invoke the given callback after the next render queue is finished
     * @param f
     */
    queueAfterRender(f) {
        this.queueRenderUpdate().callbacks.push(f);
    }

    /**
     * Queue a sync scroll
     */
    queueSyncScroll() {
        this.queueRenderUpdate().syncScroll = true;
    }

    /**
     * Changes the given columns width
     * @param {object} column - The column whose width needs to be changed
     * @param {number} width - The width of the column in pixels
     * @param {boolean} temporary - True for performance, false if the changes need to persist. Use 'true' when changing multiple columns or rapidly changing widths.
     */
    setColumnWidth(column, width, temporary) {
        column.width = width;
        this.queueAdjustColumnPositions(temporary);
        this.queueAdjustHeights();
    }

    /**
     * Calculates the total width of the given range of columns, or a single column
     * @param {number} start - Index of the first column
     * @param {number|undefined} end - Index of the last column + 1, or undefined if only a single column should be measured
     * @param {function|undefined} transform - A transformation that should be applied to each column's width before adding it
     * @returns {number} The total column width in pixels
     */
    columnWidth(start, end = undefined, transform = undefined) {
        const self = this;

        function columnWidth(x) {
            const col = self.options.columns[x];
            return self.isColumnHidden(col) ? 0 : (transform ? transform(col, col.width) : col.width);
        }

        // Calculate the width of a single column, or of a range of columns
        if (end == undefined) {
            return columnWidth(start);
        } else {
            let sum = 0;
            while (start < end) {
                sum += columnWidth(start++);
            }
            return sum;
        }
    }

    /**
     * Calculates the total height of the given range of rows, or of a single row.
     * @param {number} start - index of the first row to calculate the height for
     * @param {number} end - index of the last row to calculate the height for + 1, or undefined if only a single row should be measure
     * @returns {number} The total row height in pixels
     */
    rowHeight(start, end) {
        // if end argument is passed, calculates the accumulative heights of rows start until end (exclusive)
        if (end == undefined) {
            return this.options.rowHeight;
        } else {
            return (end - start) * this.options.rowHeight;
        }
    }

    /**
     * Finds rows within the viewport defined by both coordinates in pixels
     * @param {number} top - Viewport top coordinate in pixels
     * @param {number} bottom - Viewport bottom coordinates in pixels
     * @param {number|undefined} start - If defined, returned row positions are relative to this
     * @param {number|undefined} end - If defined, stop counting at this index
     * @returns {*}
     */
    rowsInView(top, bottom, start, end) {
        let begin = -1, ct = 0;
        for (var x = (start || 0), l = end || this.getRecordCount(); x < l; x++) {
            ct += this.rowHeight(x);
            if (ct >= top && begin === -1) {
                begin = x;
            } else if (ct > bottom) {
                break;
            }
        }
        if (begin > -1) {
            return {begin: begin - ((begin % 2) - (this.options.frozenRowsTop % 2)), end: x};
        } else {
            return {begin: 0, end: 0};
        }
    }

    /**
     * Scroll by a specific offset
     * @param {number} dX - number of pixels the grid contents should shift left
     * @param {number} dY - number of pixels the grid contents should shift up
     * @returns {boolean} false if there was no change
     */
    scrollBy(dX, dY) {
        const self = this;

        if (
            (dX < 0 && self.scroller.scrollLeft == 0) ||
            (dX > 0 && self.scroller.scrollLeft == self.scroller.scrollWidth - self.scroller.offsetWidth + scrollBarSize.width) ||
            (dY < 0 && self.scroller.scrollTop == 0) ||
            (dY > 0 && self.scroller.scrollTop == self.scroller.scrollHeight - self.scroller.offsetHeight + scrollBarSize.height)) {
            return false;
        }


        if (self.scrollBydY === undefined && self.scrollBydX === undefined) {
            self.scrollBydY = dY;
            self.scrollBydX = dX;
            (window.setImmediate || requestAnimationFrame)(() => {
                self.scroller.scrollTop += self.scrollBydY;
                self.scroller.scrollLeft += self.scrollBydX;
                self.scrollBydY = undefined;
                self.scrollBydX = undefined;
                self.afterscroll();
            });
        } else {
            self.scrollBydY += dY;
            self.scrollBydX += dX;
        }

        return true;
    }

    /**
     * Scroll to a specific location
     * @param {number} x
     * @param {number} y
     */
    scrollTo(x, y) {
        this.scroller.scrollTop = Math.max(0, y);
        this.scroller.scrollLeft = Math.max(0, x);
        this.afterscroll();
    }

    /**
     * Get the current scroll position
     * @returns {{left: number, top: number}}
     */
    getScrollPosition() {
        return {
            left: this.scroller.scrollLeft,
            top: this.scroller.scrollTop
        };
    }

    /**
     * Get the size of the
     * @returns {{width: number, height: number}}
     */
    getScrollAreaSize() {
        return {
            width: this.container.querySelector(':scope > .pg-rowgroup.pg-scrolling > .pg-container.pg-scrolling').offsetWidth,
            height: this.container.querySelector(':scope > .pg-rowgroup.pg-scrolling').offsetHeight
        };
    }

    /**
     * @private
     * @param source
     * @param event
     * @param lazy
     */
    syncScroll(source, event, lazy) {
        if (arguments.length === 1 && typeof (arguments[0]) == 'boolean') {
            lazy = arguments[0];
            source = undefined;
        }
        if (!source) source = this.scroller[0];
        this.container.querySelector(':scope > .pg-scrolling').scrollTop = source.scrollTop;
        this.middleScrollers.forEach(e => e.style.transform = 'translate(-' + source.scrollLeft + 'px,0)');
        if (!lazy) {
            this.afterscroll();
        }
    }

    /**
     * Invoked after the grid was scrolled, to schedule a viewport update etc.
     * @private
     */
    afterscroll() {
        this.updateViewport();
        this.trigger('scroll');
    }

    /**
     * Generates the cell for a given column
     * @param column
     * @param columnIdx
     * @returns {jQuery}
     */
    renderHeaderCell(column, columnIdx) {
        return createElement("div", {class: "pg-columnheader"}, [
            createElement("span", {}, [ document.createTextNode(column.title )])
        ]);
    }

    /**
     * Template for cells
     * @private
     */
    renderCellTemplate = (() => {
        const el = document.createElement("div");
        el.className = 'pg-cell';
        return el;
    })()

    /**
     * Renders the cell for a given record and column
     * @param record
     * @param column
     * @param rowIdx
     * @param columnIdx
     * @returns {Node}
     */
    renderCell(record, column, rowIdx, columnIdx) {
        // Render the cell container
        const el = this.renderCellTemplate.cloneNode();
        const content = this.renderCellContent(record, column);
        if (content) {
            el.appendChild(content);
        }
        return el;
    }

    /**
     * Renders the contents for the cell of a given record and column
     * @param record
     * @param column
     * @returns {*}
     */
    renderCellContent(record, column) {
        return this.renderCellValue(record, column, this.getCellTextValue(utils.getValue(record, column.key), record, column));
    }

    /**
     * Updates the cell values
     * @param {CellByRowIdAndColumnKey[]} list - List of row ids and column keys that should be updated
     */
    updateCellValues(list) {
        let x = 0;
        const l = list.length;
        for (; x < l; x++) {
            this.updateCellValue(list[x].id, list[x].key);
        }
    }

    /**
     * Update the given rows completely
     * @param {object[]} list - List of records to update
     */
    updateRows(list) {
        const columns = this.getVisibleColumns();
        let x = 0;
        const l = list.length;
        for (; x < l; x++) {
            let y = 0;
            const cl = columns.length;
            for (; y < cl; y++) {
                this.updateCellValue(list[x].id, columns[y].key);
            }
        }
    }

    /**
     * Invoked after a cell is rendered
     * @param {object} record - Record for which the cell was rendered
     * @param {object} column - Column for which the cell was rendered
     * @param {Node} cell - The rendered cell
     */
    afterCellRendered(record, column, cell) {

    }

    /**
     * Update the given cell
     * @param {string} rowId - id of the row to update
     * @param {string} key - key of the column to update
     */
    updateCellValue(rowId, key) {
        const row = this.findRow(rowId);
        const [cell] = Array.from(row).flatMap(e => Array.from(e.querySelectorAll(`:scope > .pg-cell[data-column-key='${key}']`)));
        if (cell) {
            const record = this.dataSource.getRecordById(rowId);
            const column = this.getColumnForKey(key);
            empty(cell);
            this.cellContentDisposed(record, column);
            cell.appendChild(this.renderCellContent(record, column));
            this.afterCellRendered(record, column, cell);
        }
    }

    /**
     * Shorthand for dataSource#getRecordById(rowId)
     * @param rowId
     */
    getRecordById(rowId) {
        return this.dataSource.getRecordById(rowId);
    }

    /**
     * Finds the row element for the given row id
     * @param {string} rowId
     * @returns NodeList
     */
    findRow(rowId) {
        return this.container.querySelectorAll(":scope > .pg-rowgroup > .pg-container > .pg-row[data-row-id='" + rowId + "']");
    }

    cellValueTemplate = (() => {
        return document.createElement("span");
    })()

    /**
     * Render the cell content for the given record, column and value
     * @param {object} record
     * @param {object} column
     * @param {*} value - The value to render.
     * @returns {Node}
     */
    renderCellValue(record, column, value) {
        // Render the cell content
        const el = this.cellValueTemplate.cloneNode();
        if (value != null) {
            el.textContent = value;
        }
        return el;
    }

    /**
     * Returns a text representation of the given value for the given record and column.
     * @param {*} value
     * @param {object} record
     * @param {object} column
     * @returns {*}
     */
    getCellTextValue(value, record, column) {
        return value
    }

    /**
     * @returns {object[]} - List of visible columns
     */
    getVisibleColumns() {
        const self = this;
        return this.options.columns.filter(c => !self.isColumnHidden(c));
    }

    /**
     * Returns the column object for the given column key
     * @param {string} key
     * @returns {object}
     */
    getColumnForKey(key) {
        return this.getColumnForIndex(this.getColumnIndexForKey(key));
    }

    /**
     * Returns the column at the given index
     * @param {number} index
     * @returns {object}
     */
    getColumnForIndex(index) {
        return this.options.columns[index];
    }

    /**
     * Returns the number of columns
     * @returns {number}
     */
    columnCount() {
        return this.options.columns.length;
    }

    /**
     * Returns the index for the column with the given key
     * @param {string} key
     * @returns {number}
     */
    getColumnIndexForKey(key) {
        // Returns the column for the given key
        let x = 0;
        const l = this.options.columns.length;
        for (; x < l; x++) {
            if (this.options.columns[x].key == key) {
                return x;
            }
        }
    }

    /**
     * Get the DOM node for the given cell
     * @param {string} rowId - Row id
     * @param {string} key - Column key
     * @returns {Node}
     */
    getCellFor(rowId, key) {
        return this.container.querySelector(".pg-row[data-row-id='" + rowId + "'] > .pg-cell[data-column-key='" + key + "']");
    }

    /**
     * Returns the row group for the given index
     * @private
     * @param rowIndex
     * @returns {*}
     */
    getRowGroupFor(rowIndex) {
        if (rowIndex < this.options.frozenRowsTop) {
            return this.headergroup;
        } else if (rowIndex > this.getRecordCount() - this.options.frozenRowsBottom) {
            return this.footergroup;
        } else {
            return this.scrollinggroup;
        }
    }

    /**
     * Returns all the parts for the given row index
     * @private
     * @param rowIndex
     */
    getRowPartsForIndex(rowIndex) {
        return this.getRowGroupFor(rowIndex).all.flatMap(e => e.querySelectorAll(":scope > .pg-row[data-row-idx='" + rowIndex + "']"));
    }

    /**
     * Stores a setting for this grid
     * @param {string} id
     * @param {*} value
     */
    saveSetting(id, value) {
        const settingsProvider = this.options.settingsProvider;
        if (settingsProvider) {
            settingsProvider.saveSetting(id, value);
        } else {
            // fallback to localStorage if no settingsProvider provided
            localStorage[this.options.settingsId + "_" + id] = JSON.stringify(value);
        }
    }

    /**
     * Loads a setting for this grid
     * @param {string} id
     * @returns {any}
     */
    loadSetting(id) {
        const settingsProvider = this.options.settingsProvider;
        if (settingsProvider) {
            return settingsProvider.loadSetting(id);
        } else {
            // fallback to localStorage if no settingsProvider provided
            const s = localStorage[this.options.settingsId + "_" + id];
            if (s) {
                return JSON.parse(s);
            }
        }
    }

    /**
     * Returns the CSS class that is used to represent the given identifier (used to transform column keys etc).
     * @param c
     * @returns {*}
     * @private
     */
    normalizeCssClass(c) {
        if (c.replace) {
            return c.replace(/[^a-zA-Z0-9]/g, '_');
        }
        return c;
    }

    /**
     * Invoked when a cell's content is removed from the DOM
     * @param {object} record
     * @param {object} column
     */
    cellContentDisposed(record, column) {
        // hook for extensions to be notified when a cell's content is removed from the DOM.
    }

    /**
     * Invoked when the grids contents is removed from the DOM
     */
    allRowsDisposed() {
        // hook for extensions to be notified when the whole grid's contents are removed from the DOM.
    }

    /**
     * Remove the given rows from the DOM
     * @private
     * @param rows
     */
    destroyRows(rows) {
        rows.forEach(node => node.parentNode.removeChild(node));
        if (typeof this.rowsDisposed === 'function') {
            this.rowsDisposed(this.getIdsFromRows(rows));
        }
    }

    /**
     * Extract the row id's from the given row DOM nodes
     * @private
     * @param {Node[]} rows
     */
    getIdsFromRows(rows) {
        return rows.map(r => r.getAttribute('data-row-id')).toArray();
    }

    /**
     * Updates a single row's height
     * @private
     * @param {number} rowIndex
     */
    updateRowHeight(rowIndex) {
        const parts = this.getRowPartsForIndex(rowIndex);
        parts.forEach(e => e.style.height = this.rowHeight(rowIndex) + "px");
    }

    /**
     * @returns {number} the viewports width in pixels
     */
    viewportWidth() {
        return this.container.width() - scrollBarSize.width;
    }

    /**
     * Invoked when the grid container has resized.
     */
    resize() {
        // indicate that the grid container has resized. used in extensions.
    }

    /**
     * Checks grid DOM tree against internal data:
     * - data-row-idx against viewport.begin and viewport.end
     * - data-row-id against workingSet
     * - amount of rows against viewport size
     */
    verify() {
        const rowGroups = this.scrollinggroup.all;
        let hasError = false;
        for (let g = 0; g < rowGroups.length; g++) {
            const group = rowGroups[g];
            const rows = group.children;
            if (rows.length !== this.viewport.end - this.viewport.begin) {
                debugger;
                hasError = true;
                console.error("Rowgroup does not contain expected amount of rows", group, this.viewport);
            } else {
                for (let r = 0; r < rows.length; r++) {
                    const row = rows[r];
                    const record = this.workingSet[this.viewport.begin + r].record;
                    if (parseInt(row.getAttribute("data-row-idx")) !== this.viewport.begin + r) {
                        debugger;
                        hasError = true;
                        console.error("Row does not have matching index", row, record, this.viewport, r);
                    }
                    if (record !== undefined && row.hasAttribute("data-row-id") && row.getAttribute("data-row-id") != record.id) {
                        debugger;
                        hasError = true;
                        console.error("Row does not have matching identifier", row, record, this.viewport, r);
                    }
                }
            }
        }
    }

    translate(key) {
        let langCode = this.options.languageCode;
        if (translations[langCode] === undefined) {
            langCode = 'en';
        }

        return key.split('.').reduce((m, key) => m[key], translations[langCode]);
    }
}

export default PowerGrid;
