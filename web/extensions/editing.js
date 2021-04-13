import override from "../override.js";
import utils, {filterEvent} from "../utils.js";

export default function (grid, pluginOptions) {
    override(grid, function ($super) {
        var editedCellMapByRowId = {};
        var editedCellMapByRowIdx = [];
        var editedRowIdMap = {};

        return {
            renderCell: function (record, column, rowIndex, columnIndex) {
                var cell = $super.renderCell.apply(this, arguments);

                var editable = this.editing.isEditable(record, column);
                if (editable) {
                    cell.classList.add("pg-editable");
                }

                return cell;
            },

            rowHeight: function (start, end) {
                if (pluginOptions.additionalRowHeight !== undefined) {
                    if (end !== undefined) {
                        var editedRowCountInWindow = Object.keys(editedCellMapByRowIdx).filter(function (i) {
                            return start <= parseInt(i) && parseInt(i) < end;
                        }).length;
                        return $super.rowHeight(start, end) + editedRowCountInWindow * pluginOptions.additionalRowHeight;
                    } else {
                        return $super.rowHeight(start) + (editedCellMapByRowIdx[start] ? pluginOptions.additionalRowHeight : 0);
                    }
                } else {
                    return $super.rowHeight(start, end);
                }
            },

            updateCellValue: function (rowId, key) {
                if (!grid.editing.isEditing(rowId, key)) {
                    return $super.updateCellValue(rowId, key);
                }
            },

            init: function () {
                var grid = this;

                $super.init();

                if (pluginOptions.editOnClick !== false) {
                    this.container.addEventListener("click", filterEvent(".pg-cell.pg-editable:not(.pg-editing)", function (event) {
                        var targetCell = event.target;
                        while (targetCell && !$(targetCell).is('.pg-cell')) {
                            targetCell = targetCell.parentNode;
                        }

                        var key = $(targetCell).attr('data-column-key');
                        var rowId = $(targetCell).parents(".pg-row:eq(0)").data('row-id');
                        var rowIdx = $(targetCell).parents(".pg-row:eq(0)").data('row-idx');
                        var record = grid.dataSource.getRecordById(rowId);

                        grid.editing.startEdit(targetCell, key, record, rowIdx);
                    }));
                }

                if (pluginOptions.mode === 'row') {
                    this.container.addEventListener("click", filterEvent("[pg-role]", function (event) {
                        var target = $(event.target);
                        if (!target.is("[pg-role]")) {
                            target = target.parents("[pg-role]").first();
                        }
                        var rowId = target.parents(".pg-row:eq(0)").data('row-id');
                        var rowIdx = target.parents(".pg-row:eq(0)").data('row-idx');
                        var role = target.first().attr("pg-role");
                        var record = grid.dataSource.getRecordById(rowId);

                        switch (role) {
                            case 'edit-row':
                                grid.editing.startRowEdit(record, rowIdx);
                                break;
                            case 'commit-row':
                                grid.editing.commitRow(record, rowIdx);
                                break;
                            case 'rollback-row':
                                grid.editing.abortRowEdit(record, rowIdx);
                                break;
                        }
                    }));
                }

                this.dataSource.on('editabilitychanged', function (attr) {
                    grid.editing.updateEditability(attr.values);
                });
            },

            editing: {
                grid: grid,
                editors: {},

                addEditor: function (column, editor) {
                    this.editors[column.key] = editor;
                },

                isEditable: function (record, column) {
                    var editable = column.editable;
                    if (editable && typeof pluginOptions.isEditable === 'function') {
                        editable = pluginOptions.isEditable.apply(grid, [record, column]);
                    }
                    return editable;
                },

                isEditing: function (rowId, key) {
                    return (editedCellMapByRowId[rowId] && (editedCellMapByRowId[rowId].indexOf(key) > -1)) === true;
                },

                startRowEdit: function (record, rowIdx) {
                    var columns = grid.getVisibleColumns(),
                        rowParts = grid.getRowPartsForIndex(rowIdx);

                    for (var x = 0, l = columns.length; x < l; x++) {
                        var column = columns[x];
                        if (this.isEditable(record, column)) {
                            var cell = rowParts.find(".pg-cell[data-column-key='" + column.key + "']");
                            this.startEdit(cell, column.key, record, rowIdx);
                        }
                    }

                    rowParts.addClass("pg-editing");

                    if (pluginOptions.additionalRowHeight !== undefined) {
                        grid.updateRowHeight(rowIdx);
                    }

                    grid.trigger('startrowedit', record.id);

                    editedRowIdMap[record.id] = true;
                },

                endRowEdit: function (record, rowIdx) {
                    var rowId = record.id;
                    if (editedRowIdMap[rowId]) {
                        delete editedRowIdMap[rowId];

                        var rowParts = grid.getRowPartsForIndex(rowIdx);
                        rowParts.removeClass("pg-editing");

                        if (editedCellMapByRowId[rowId]) {
                            var editedCells = editedCellMapByRowId[rowId];
                            for (var x = 0, l = editedCells.length; x < l; x++) {
                                var column = grid.getColumnForKey(editedCells[x]),
                                    cell = rowParts.find(".pg-cell[data-column-key='" + column.key + "']");

                                this.endEdit(cell, record, rowIdx, column);
                            }
                        }

                        grid.trigger('endrowedit', record.id);
                    }
                },

                commitRow: function (record, rowIdx) {
                    if (typeof grid.dataSource.commitRow === 'function') {
                        Promise.resolve(grid.dataSource.commitRow(record)).then(function () {
                            grid.editing.endRowEdit(record, rowIdx);
                        })
                    } else {
                        throw "DataSource does not implement commitRow(record)";
                    }
                },

                abortRowEdit: function (record, rowIdx) {
                    if (typeof grid.dataSource.rollbackRow === 'function') {
                        Promise.resolve(grid.dataSource.rollbackRow(record)).then(function () {
                            grid.editing.endRowEdit(record, rowIdx);
                        })
                    } else {
                        grid.editing.endRowEdit(record, rowIdx);
                    }
                },

                startEdit: function (target, key, record, rowIdx) {
                    if (arguments.length === 2) {
                        key = arguments[0];
                        record = arguments[1];
                        target = grid.getCellFor(record.id, key);
                        rowIdx = grid.indexOfRow(record);
                    }
                    var rowId = record.id;
                    var column = grid.getColumnForKey(key);
                    var oldValue = utils.getValue(record, key);
                    var editor = this.createEditor(record, column, oldValue);
                    var editing = this;

                    if (!(rowId in editedCellMapByRowId) && typeof grid.dataSource.startEdit == 'function') {
                        grid.dataSource.startEdit(record);
                    }

                    grid.scrollToCell(rowIdx, key);

                    if ($(target).is('.pg-editing')) return;

                    if (!this.isEditable(record, column)) return;

                    var opts = {
                        cell: target,
                        key: key,
                        record: record,
                        rowIdx: rowIdx,
                        column: column
                    };

                    var beforeEditEvent = new $.Event('beforeedit', opts);
                    grid.trigger(beforeEditEvent);

                    if (beforeEditEvent.isDefaultPrevented()) {
                        return;
                    }

                    $(editor).on('commit', function (event, value, move) {
                        utils.inAnimationFrame(function () {
                            editing.commit(target, record, rowIdx, column, value, oldValue, move);
                        });
                    }).on('abort', function (event) {
                        utils.inAnimationFrame(function () {
                            editing.abort(target, record, rowIdx, column, oldValue);
                        });
                    });
                    $(target).addClass('pg-editing').empty().append(editor);

                    grid.cellContentDisposed(record, column);

                    editedCellMapByRowId[rowId] = editedCellMapByRowIdx[rowIdx] = (editedCellMapByRowIdx[rowIdx] || []).concat(key);

                    grid.trigger('startedit', record.id, key);
                },

                commit: function (target, record, rowIdx, column, value, oldValue, move) {
                    try {
                        grid.dataSource.setValue(record.id, column.key, value);
                    } catch (e) {
                        console.error("Exception while committing value", record, column, value, e);
                    }
                    this.endEdit(target, record, rowIdx, column, grid.dataSource.getRecordById(record.id)[column.key]);

                    var nextRowIdx = rowIdx, nextColumn = column, nextRecord = record;

                    if (move) {
                        switch (move) {
                            case 1:
                            case -1:
                                do {
                                    nextRowIdx += move;
                                    nextRecord = grid.getRow(nextRowIdx);
                                } while (nextRecord && !this.isEditable(nextRecord, nextColumn));
                                break;
                            case 2:
                            case -2:
                                var i = grid.getColumnIndexForKey(column.key);
                                do {
                                    i += move / 2;
                                    if (i >= grid.columnCount() || i < 0) {
                                        nextRowIdx += move / 2;
                                        nextRecord = grid.getRow(nextRowIdx);
                                        i = move < 0 ? grid.columnCount() - 1 : 0;
                                    }
                                    nextColumn = grid.getColumnForIndex(i);
                                } while (nextRecord && !this.isEditable(nextRecord, nextColumn));
                                break;
                        }

                        if (nextRecord) {
                            var targetCell = grid.getCellFor(nextRecord.id, nextColumn.key);

                            this.startEdit(targetCell, nextColumn.key, nextRecord, nextRowIdx);
                        }
                    }
                },

                abort: function (target, record, rowIdx, column, oldValue) {
                    this.endEdit(target, record, rowIdx, column, oldValue);
                },

                endEdit: function (target, record, rowIdx, column, value) {
                    var rowId = record.id;
                    $(target).removeClass('pg-editing');

                    editedCellMapByRowId[rowId] = editedCellMapByRowIdx[rowIdx] = editedCellMapByRowIdx[rowIdx].filter(function (k) {
                        return k !== column.key
                    });
                    if (editedCellMapByRowIdx[rowIdx].length === 0) {
                        delete editedCellMapByRowIdx[rowIdx];
                        delete editedCellMapByRowId[rowId]
                    }

                    grid.updateCellValue(record.id, column.key);

                    if (pluginOptions.additionalRowHeight !== undefined) {
                        grid.updateRowHeight(rowIdx);
                    }
                },

                createDefaultEditor: function (record, column, value) {
                    return $("<input>").attr("type", column.type).val(value);
                },

                createEditor: function (record, column, value) {
                    var editor;
                    if (pluginOptions.editors && pluginOptions.editors[column.type]) {
                        editor = pluginOptions.editors[column.type](record, column, value);
                    } else if (column.editor) {
                        editor = column.editor(record, column, value);
                    } else if (typeof pluginOptions.defaultEditor === 'function') {
                        editor = pluginOptions.defaultEditor(record, column, value);
                    } else {
                        editor = this.createDefaultEditor(record, column, value);
                    }

                    if (editor instanceof Element || editor instanceof DocumentFragment || editor instanceof $) {
                        var element = editor;
                        editor = {
                            editor: element,
                            value: function () {
                                return $(element).val();
                            },
                            on: function (eventName, handler) {
                                $(element).on(eventName, handler);
                            }
                        }
                    }

                    var hasChanged = false;
                    editor.on("keydown", function (event) {
                        switch (event.keyCode) {
                            case 13:
                                event.preventDefault();
                                $(this).trigger('commit', [editor.value(), event.shiftKey ? -1 : 1]);
                                break;
                            case 27:
                                event.preventDefault();
                                $(this).trigger('abort');
                                break;
                            case 9:
                                event.preventDefault();
                                $(this).trigger('commit', [editor.value(), event.shiftKey ? -2 : 2]);
                                break;
                        }
                    });

                    editor.on("blur", function () {
                        if (pluginOptions.commitOnBlur !== false && hasChanged) {
                            $(this).trigger('commit', [editor.value()]);
                        } else if (pluginOptions.abortOnBlur === true || (pluginOptions.commitOnBlur !== false && !hasChanged)) {
                            $(this).trigger('abort');
                        }
                    });

                    editor.on("change", function () {
                        hasChanged = true;
                        if (pluginOptions.liveUpdate === true) {
                            try {
                                grid.dataSource.setValue(record.id, column.key, editor.value());
                            } catch (e) {
                                console.error("Exception while committing value", record, column, editor.value(), e);
                            }
                        }
                    });

                    var editorNode = $(editor.editor)[0];

                    if (editorNode.select) {
                        setTimeout(function () {
                            editorNode.select();
                        }, 10);
                    } else if (editorNode.focus) {
                        setTimeout(function () {
                            editorNode.focus();
                        }, 10);
                    }
                    return editor.editor;
                },

                updateEditability: function (cells) {
                    for (var x = 0, l = cells.length; x < l; x++) {
                        var cell = cells[x],
                            column = grid.getColumnForKey(cell.key),
                            row = grid.getRecordById(cell.id),
                            cellElement = column && row && grid.getCellFor(cell.id, cell.key);
                        if (cellElement) {
                            this.updateCellEditability(row, column, cellElement);
                        }
                    }
                },

                updateCellEditability: function (row, column, cellElement) {
                    $(cellElement).toggleClass("pg-editable", this.isEditable(row, column));
                }
            }
        }
    });
}
