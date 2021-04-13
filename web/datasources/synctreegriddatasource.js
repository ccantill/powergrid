import utils from "../utils.js";

/**
 * Takes a TreeSource and adapts it to represent the flat list of expanded nodes. This is a specialised implementation
 * that is optimised for use with synchronous TreeSources; i.e. it assumes the tree source does not return Promises.
 * @module SyncTreeGridDataSource
 * @param {TreeSource} treesource
 * @constructor
 */
function SyncTreeGridDataSource(treesource) {
    utils.Evented.apply(this);

    this.treesource = treesource;

    this.expandedById = {};

    if (this.treesource.isReady()) {
        this.load();
    }

    this.treesource.on("dataloaded", this.load.bind(this));

    this.passthroughFrom(this.treesource, "datachanged", "editabilitychanged", "validationresultchanged");

    utils.passthrough(this, treesource, ['hasSubView', 'getSummaryRow', 'queryForExport']);
}

SyncTreeGridDataSource.prototype = /** @lends SyncTreeGridDataSource.prototype */ {
    load: function () {
        this.nodesById = {};
        this.view = this.flattenTree(this.treesource.getRootNodes(), 0);
        this.trigger("dataloaded");
    },

    isReady: function () {
        return this.view && true;
    },

    flattenTree: function (nodes, level) {
        var self = this, treesource = this.treesource;

        var list = [];

        function flatten(nodes, level) {
            for (var x = 0, l = nodes.length; x < l; x++) {
                var node = nodes[x];
                list.push(self.nodesById[node.id] = {
                    record: node,
                    level: level
                });
                if (self.isExpanded(node)) {
                    flatten(treesource.children(node), level + 1);
                }
            }
        }

        flatten(nodes, level);

        return list;
    },

    isExpanded: function (row) {
        return this.expandedById[row.id] === true;
    },

    findNodeForRowId: function (id) {
        return this.nodesById[id];
    },

    getTreeLevel: function (row) {
        return this.findNodeForRowId(row.id).level;
    },

    hasChildren: function (row) {
        return this.treesource.hasChildren(row);
    },

    getData: function (start, end) {
        return this.view.slice(start || 0, end).map(function (node) {
            return node.record;
        });
    },

    expand: function (row) {
        if (!this.isExpanded(row)) {
            this.expandedById[row.id] = true;

            var node = this.findNodeForRowId(row.id);

            var idx = this.view.indexOf(node) + 1;
            if (idx > 0) {
                var subtree = this.flattenTree(this.treesource.children(row), node.level + 1);
                this.view = this.view.slice(0, idx).concat(subtree).concat(this.view.slice(idx));
                this.trigger('rowsadded', {start: idx, end: idx + subtree.length});
            }
            this.trigger('treetoggled', {id: row.id, index: idx, state: true});
        }
    },

    expandAll: function (rowId) {
        var self = this;

        function expand(nodes) {
            for (var x = 0, l = nodes.length; x < l; x++) {
                self.expand(nodes[x]);
                if (self.treesource.hasChildren(nodes[x])) {
                    expand(self.treesource.children(nodes[x]));
                }
            }
        }

        expand(rowId ? [this.getRecordById(rowId)] : this.treesource.getRootNodes());
    },

    collapse: function (row) {
        if (this.isExpanded(row)) {
            this.expandedById[row.id] = false;

            var node = this.findNodeForRowId(row.id);
            var startIdx = this.view.indexOf(node) + 1;
            if (startIdx > 0) {
                var endIdx = startIdx;
                for (let l = this.view.length; endIdx < l && this.view[endIdx].level > node.level; endIdx++) ;

                this.view.splice(startIdx, endIdx - startIdx);
                this.trigger('rowsremoved', {start: startIdx, end: endIdx});
            }
            this.trigger('treetoggled', {id: row.id, index: startIdx, state: false});
        }
    },

    toggle: function (rowId) {
        var row = this.getRecordById(rowId);
        if (this.isExpanded(row)) {
            this.collapse(row);
        } else {
            this.expand(row);
        }
    },

    expandToLevel: function (depth) {
        var self = this;

        function expand(nodes, depth) {
            for (var x = 0, l = nodes.length; x < l; x++) {
                self.expand(nodes[x]);
                if (depth > 1) {
                    expand(self.treesource.children(nodes[x]), depth - 1);
                }
            }
        }

        expand(this.treesource.getRootNodes(), depth);
    },

    getRecordById: function (id) {
        return this.treesource.getRecordById(id);
    },

    sort: function (comparator) {
        this.treesource.sort(comparator);
    },

    applyFilter: function (columnSettings, filterFunction) {
        this.treesource.filter(columnSettings, filterFunction);
    },

    setValue: function (rowId, key, value) {
        this.treesource.setValue(rowId, key, value);
    },

    recordCount: function () {
        return this.view.length;
    }
};

export default SyncTreeGridDataSource;
