import override from "../override.js";
import utils, {filterEvent} from "../utils.js";

export default {
    loadFirst: ['filtering'],
    init: function (grid, pluginOptions) {
        override(grid, function ($super) {
            return {
                renderHeaderCell: function (column, columnIdx) {
                    var h = $super.renderHeaderCell(column, columnIdx);
                    if (column.resizable !== false) {
                        var handle = $("<div class='pg-resizehandle'></div>");
                        h.append(handle);
                    }
                    return h;
                },

                init: function () {
                    for (var x = 0, l = this.options.columns.length; x < l; x++) {
                        var column = this.options.columns[x];
                        var width = this.loadSetting(column.key + "_width");
                        if (width !== undefined && width !== null && width !== "") {
                            column.width = width;
                        }
                    }

                    $super.init();
                    var header, key, idx, col, oX, w, offset, resizing = 0,
                        minSize = pluginOptions.minSize || 20;

                    function startResize(event) {
                        if ($(this).parents('.powergrid')[0] !== grid.container[0]) return;
                        header = event.target.parentNode;
                        key = $(header).attr("data-column-key");
                        idx = utils.findInArray(grid.options.columns, function (col) {
                            return col.key == key;
                        });
                        col = grid.options.columns[idx];

                        if (col.resizable === false) {
                            return;
                        }

                        if (grid.flexcolumns && grid.flexcolumns.deflex) {
                            grid.flexcolumns.deflex();
                        }

                        oX = event.pageX;
                        w = grid.columnWidth(idx);

                        offset = event.offsetX || event.originalEvent.layerX || 0;

                        if (idx < grid.options.columns.length - grid.options.frozenColumnsRight) { // it's not a right frozen column
                            resizing = 1;
                        } else if (idx >= grid.options.columns.length - grid.options.frozenColumnsRight) {
                            resizing = -1;
                        }
                    }

                    function doResize(event) {
                        var width;
                        if (resizing === 1) {
                            width = Math.max(minSize, event.pageX - oX + w);
                        } else if (resizing === -1) {
                            width = Math.max(minSize, oX - event.pageX + w);
                        } else {
                            return;
                        }

                        grid.setColumnWidth(col, width, true);
                    }

                    function endResize(event) {
                        if (resizing !== 0) {
                            resizing = 0;
                            grid.saveSetting(col.key + "_width", col.width);
                            event.preventDefault();
                            event.stopImmediatePropagation();
                            grid.queueAdjustColumnPositions(false);
                        }
                    }

                    this.container.addEventListener("mousedown", filterEvent(".pg-resizehandle", startResize));
                    this.container.addEventListener("mousemove", doResize);
                    this.container.addEventListener("click", filterEvent(".pg-resizehandle", function (event) {
                            event.stopImmediatePropagation();
                            event.preventDefault();
                            event.stopPropagation();
                        }));

                    window.addEventListener("mouseup", endResize);
                }
            }
        });
    }
};
