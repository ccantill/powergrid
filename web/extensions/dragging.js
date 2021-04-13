import override from "../override.js";
import utils, {filterEvent} from "../utils.js";

export default {
    loadFirst: ['filtering'],
    init: function (grid, pluginOptions) {
        override(grid, function ($super) {
            return {
                init: function () {
                    $super.init();

                    var cells, oX, oY, dragstarted, tracking, col, startX, idx, offset, header,
                        key, dragTarget, offsetX, offsetY;

                    function startDrag(event) {
                        // disable drag preview
                        event.preventDefault();

                        if ($(this).parents(".powergrid")[0] !== grid.container[0]) return;
                        header = this;
                        key = $(header).attr("data-column-key");
                        if (!key) return;
                        idx = utils.findInArray(grid.options.columns, function (col) {
                            return col.key == key;
                        });
                        col = grid.getColumnForIndex(idx);

                        if (col.draggable === false) {
                            return;
                        }

                        var columns = grid.options.columns;
                        startX = columns[idx].offsetLeft;

                        oX = event.pageX;
                        oY = event.pageY;

                        offsetX = event.offsetX;
                        offsetY = event.offsetY;

                        offset = event.offsetX || event.originalEvent.layerX || 0;

                        if (offset <= header.offsetWidth - 8 && offset >= 8) {
                            cells = $(grid.target).find("> .powergrid > .pg-rowgroup > .pg-container > .pg-row > .pg-column" + grid.normalizeCssClass(key) + ", > .powergrid > .pg-rowgroup > .pg-container > .pg-row > .pg-inner-row > .pg-column" + grid.normalizeCssClass(key) + ", > .powergrid > .pg-columnheaders > .pg-container > .pg-row > .pg-column" + key + "");

                            tracking = true;
                            dragstarted = false;

                            $(header).addClass("pg-dragging");

                            grid.trigger('columngrabstart', {column: col});

                            event.stopPropagation();
                        }
                    }

                    function doDrag(event) {
                        if (!tracking) return;

                        var dX = event.pageX - oX, dY = event.pageY - oY;

                        if (!dragstarted) {
                            var dragevent = new $.Event('columndragstart', {
                                idx: idx,
                                column: col,
                                offsetX: offsetX,
                                offsetY: offsetY
                            });

                            if (event.isDefaultPrevented()) {
                                return;
                            }

                            if (dX * dX + dY * dY > 400) {
                                cells.addClass("pg-columndragging");
                                $(header).addClass("pg-columndragging");
                                dragstarted = true;
                                grid.trigger(dragevent);
                            } else {
                                return;
                            }
                        }

                        var newX = (startX + event.pageX - oX), newY = event.pageY - oY,
                            outOfViewPort, resetCellStyles;

                        if (pluginOptions.allowDragOutsideOfViewPort) {
                            var element = utils.elementFromPoint(event.pageX, event.pageY, ".pg-column-dragtarget");

                            if (element && element !== dragTarget) {
                                var event = new $.Event("columndragenter", {
                                    column: col
                                });

                                element.trigger(event);

                                if (dragTarget) dragTarget.removeClass("pg-column-dragtarget-focussed");
                                else resetCellStyles = true;

                                if (!event.isDefaultPrevented()) {
                                    element.addClass("pg-column-dragtarget-focussed");
                                    dragTarget = element;
                                    outOfViewPort = true;
                                }
                            } else if (dragTarget) {
                                dragTarget.trigger("columndragexit");
                                dragTarget.removeClass("pg-column-dragtarget-focussed");
                                dragTarget = null;
                            }
                        }

                        grid.trigger(new $.Event("columndragmove", {
                            column: col, x: newX, y: newY, outOfViewPort: outOfViewPort
                        }));

                        requestAnimationFrame(function () {
                            if (!tracking) return;
                            if (outOfViewPort) {
                                if (resetCellStyles) {
                                    cells.css({"transform": ""});
                                }
                                $(header).css({"transform": "translate(" + (newX - col.offsetLeft) + "px, " + newY + "px)"});
                            } else {
                                $(header).css({"transform": "translate(" + (newX - col.offsetLeft) + "px)"});
                                cells.css({"transform": "translate(" + (newX - col.offsetLeft) + "px)"});
                            }
                        });
                    }

                    function endDrag(event) {
                        $(header).removeClass("pg-dragging");
                        tracking = false;
                        if (dragstarted) {
                            if (dragTarget) {
                                dragTarget.trigger(new $.Event("columndropped", {
                                    column: col
                                }));
                                dragTarget.removeClass("pg-column-dragtarget-focussed");
                                dragTarget = null;
                            }

                            //if(event.type === 'mouseup' && ($(event.target).hasClass('pg-columnheader') || $(event.target).parents(".pg-columnheader").length)) return;

                            grid.trigger(new $.Event("columndragend"));

                            dragstarted = false;

                            $(grid.baseSelector + " .pg-column" + grid.normalizeCssClass(col.key)).css({"transform": ""});
                            cells.removeClass("pg-columndragging");
                            $(header).removeClass("pg-columndragging");

                            event.preventDefault();
                            event.stopImmediatePropagation();
                            grid.trigger('columndragend', {column: col});
                        }
                        grid.trigger('columngrabend', {column: col});

                        // clean up
                        cells = null;
                        col = null;
                        header = null;
                        key = null;
                    }

                    this.container.addEventListener("mousedown", filterEvent(".pg-columnheader", startDrag));
                    this.container.addEventListener("click", filterEvent(".pg-columnheader", endDrag));

                    window.addEventListener("mousemove", doDrag);
                    window.addEventListener("mouseup", endDrag);
                },

                destroy: function () {
                    // $(window).off("mousemove." + this.id).off("mouseup." + this.id); // FIXME
                    $super.destroy();
                },

                renderHeaderCell: function (column, colIdx) {
                    var cell = $super.renderHeaderCell(column, colIdx);
                    $(cell).addClass("pg-draggable");
                    return cell;
                }
            }
        });
    }
}
