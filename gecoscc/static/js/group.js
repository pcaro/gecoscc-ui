/*jslint browser: true, unparam: true, nomen: true, vars: false */
/*global App, GecosUtils, gettext */

// Copyright 2013 Junta de Andalucia
//
// Licensed under the EUPL, Version 1.1 or - as soon they
// will be approved by the European Commission - subsequent
// versions of the EUPL (the "Licence");
// You may not use this work except in compliance with the
// Licence.
// You may obtain a copy of the Licence at:
//
// http://ec.europa.eu/idabc/eupl
//
// Unless required by applicable law or agreed to in
// writing, software distributed under the Licence is
// distributed on an "AS IS" basis,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
// express or implied.
// See the Licence for the specific language governing
// permissions and limitations under the Licence.

App.module("Group.Models", function (Models, App, Backbone, Marionette, $, _) {
    "use strict";

    Models.GroupModel = App.GecosResourceModel.extend({
        resourceType: "group",

        defaults: {
            name: "",
            groupmembers: [],
            nodemembers: []
        }
    });

    Models.GroupCollection = Backbone.Collection.extend({
        model: Models.GroupModel,

        url: function () {
            return "/api/groups/";
        },

        parse: function (response) {
            return response.nodes;
        }
    });

    Models.PaginatedGroupCollection = Backbone.Paginator.requestPager.extend({
        model: Models.GroupModel,

        paginator_core: {
            type: "GET",
            dataType: "json",
            url: "/api/groups/"
        },

        paginator_ui: {
            firstPage: 0,
            currentPage: 0,
            perPage: 16,
            pagesInRange: 2,
            // 10 as a default in case your service doesn't return the total
            totalPages: 10
        },

        server_api: {
            page: function () { return this.currentPage; },
            pagesize: function () { return this.perPage; }
        },

        parse: function (response) {
            this.totalPages = response.pages;
            return response.nodes;
        }
    });
});

App.module("Group.Views", function (Views, App, Backbone, Marionette, $, _) {
    "use strict";

    Views.GroupMembers = Marionette.ItemView.extend({
        template: "#groupmembers-template",

        initialize: function (options) {
            this.groupmembers = options.groupmembers;
        },

        serializeData: function () {
            return {
                groupmembers: _.pairs(this.groupmembers)
            };
        }
    });

    Views.NodeMembers = Marionette.ItemView.extend({
        template: "#nodemembers-template",

        initialize: function (options) {
            this.nodemembers = options.nodemembers;
        },

        serializeData: function () {
            return {
                nodemembers: _.pairs(this.nodemembers)
            };
        }
    });

    Views.GroupForm = Marionette.Layout.extend({
        template: "#groups-form-template",
        tagName: "div",
        className: "col-sm-12",

        regions: {
            memberof: "#memberof",
            groupmembers: "#groupmembers",
            nodemembers: "#nodemembers"
        },

        events: {
            "click button#delete": "deleteModel",
            "click button#save": "save",
            "click button#goback": "go2table"
        },

        renderMembers: function (propName, View) {
            var oids = this.model.get(propName).join(','),
                aux = {},
                that = this;

            if (oids.length === 0) {
                aux[propName] = {};
                aux = new View(aux);
                this[propName].show(aux);
            } else {
                $.ajax("/api/nodes/?oids=" + oids).done(function (response) {
                    var items = response.nodes,
                        members = {},
                        view;

                    _.each(items, function (el) {
                        members[el._id] = el.name;
                    });

                    aux[propName] = members;
                    view = new View(aux);
                    that[propName].show(view);
                });
            }
        },

        onRender: function () {
            var that = this,
                groups,
                widget,
                promise;

            if (App.instances.groups && App.instances.groups.length > 0) {
                groups = App.instances.groups;
                promise = $.Deferred();
                promise.resolve();
            } else {
                groups = new App.Group.Models.GroupCollection();
                promise = groups.fetch();
            }

            widget = new Views.GroupWidget({
                collection: groups,
                checked: this.model.get("memberof"),
                unique: true
            });
            promise.done(function () {
                that.memberof.show(widget);
            });

            this.renderMembers("groupmembers", Views.GroupMembers);
            this.renderMembers("nodemembers", Views.NodeMembers);
        },

        deleteModel: function (evt) {
            evt.preventDefault();
            var that = this;

            GecosUtils.askConfirmation({
                callback: function () {
                    that.model.destroy({
                        success: function () {
                            App.instances.tree.reloadTree();
                            App.instances.router.navigate("", { trigger: true });
                        }
                    });
                },
                message: "Deleting a Group is a permanent action."
            });
        },

        save: function (evt) {
            evt.preventDefault();
            var name, memberof, $button;

            name = this.$el.find("#name").val().trim();
            if (name.length === 0) {
                this.$el.find("#name").parent().addClass("has-error");
                return;
            }
            this.$el.find("#name").parent().removeClass("has-error");
            this.model.set("name", name);

            $button = $(evt.target);
            $button.tooltip({
                html: true,
                title: "<span class='fa fa-spin fa-spinner'></span> " + gettext("Saving") + "..."
            });
            $button.tooltip("show");

            memberof = this.memberof.currentView.getChecked();
            this.model.set("memberof", memberof);

            this.model.save()
                .done(function () {
                    $button.tooltip("destroy");
                    $button.tooltip({
                        html: true,
                        title: "<span class='fa fa-check'></span> " + gettext("Done")
                    });
                    $button.tooltip("show");
                    setTimeout(function () {
                        $button.tooltip("destroy");
                        App.instances.router.navigate("", { trigger: true });
                    }, 1500);
                })
                .fail(function () {
                    $button.tooltip("destroy");
                    $button.tooltip({
                        html: true,
                        title: "<span class='text-danger fa fa-exclamation-triangle'></span> " + gettext("Failure")
                    });
                    $button.tooltip("show");
                });
        },

        go2table: function (evt) {
            evt.preventDefault();
            App.instances.router.navigate("", { trigger: true });
        }
    });

    Views.GroupWidget = Marionette.ItemView.extend({
        template: "#groups-widget-template",

        unique: false,
        checked: undefined,

        initialize: function (options) {
            if (_.has(options, "unique")) {
                this.unique = options.unique;
            }
            if (_.has(options, "checked")) {
                this.checked = options.checked;
            }
        },

        ui: {
            filter: "input.group-filter"
        },

        events: {
            "keyup @ui.filter": "filterGroups",
            "click .group-filter-btn": "cleanFilter"
        },

        serializeData: function () {
            var data = {},
                aux,
                groups;

            if (this.collection) {
                if (this.unique) {
                    if (_.isUndefined(this.checked)) {
                        this.checked = "";
                    }
                } else if (_.isUndefined(this.checked)) {
                    this.checked = [];
                }

                aux = _.flatten([this.checked]);
                // Sort the groups, checked first
                groups = this.collection.toJSON();
                groups = _.sortBy(groups, function (g) {
                    return _.contains(aux, g.id) ? 0 : 1;
                });

                data = {
                    unique: this.unique,
                    items: groups,
                    checked: this.checked
                };
            }
            return data;
        },

        onRender: function () {
            if (this.unique) {
                this.$el.find("select").chosen();
            }
        },

        filterGroups: function (evt) {
            evt.preventDefault();
            var filter = this.ui.filter.val();

            this.$el.find("label.group").each(function (index, label) {
                var $label = $(label),
                    filterReady = filter.trim().toLowerCase(),
                    text = $label.text().trim().toLowerCase();
                if (filterReady.length === 0 || text.indexOf(filterReady) >= 0) {
                    $label.parent().show();
                } else {
                    $label.parent().hide();
                }
            });
        },

        cleanFilter: function (evt) {
            this.ui.filter.val("");
            this.filterGroups(evt);
            this.ui.filter.focus();
        },

        getChecked: function () {
            var result;
            if (this.unique) {
                result = this.$el.find("option:selected").val();
                if (result.length === 0) { return null; }
                return result;
            }
            return _.map(this.$el.find("input:checked"), function (item) {
                return $(item).attr("id");
            });
        }
    });

    Views.MultiGroupWidget = Marionette.ItemView.extend({
        template: "#groups-multi-widget-template",

        groupTpl: _.template("<li><label class='group checkbox-inline'>" +
                             "<input type='checkbox'" +
                             "       id='<%= id %>'" +
                             "       <%= checked %>>" +
                             "<%= name %></label></li>"),

        checked: [],

        initialize: function (options) {
            var that = this;
            if (_.has(options, "checked") && _.isArray(options.cheked)) {
                this.checked = options.checked;
            }
            this.collection = new App.Group.Models.PaginatedGroupCollection();
            this.collection.goTo(0, {
                success: function () { that.render(); }
            });
        },

        ui: {
            filter: "input.group-filter"
        },

        events: {
            "keyup @ui.filter": "filterGroups",
            "click .group-filter-btn": "cleanFilter",
            "click ul.pagination a": "goToPage"
        },

        serializeData: function () {
            var paginator = [],
                inRange = this.collection.pagesInRange,
                pages = inRange * 2 + 1,
                current = this.collection.currentPage,
                i = 0,
                page;

            for (i; i < pages; i += 1) {
                page = current - inRange + i;
                if (page >= 0 && page < this.collection.totalPages) {
                    paginator.push([page, page === current]);
                }
            }
            return {
                prev: true, // FIXME
                next: true,
                pages: paginator,
                showLoader: this.showLoader
            };
        },

        onRender: function () {
            var groups = this.collection.toJSON(),
                lists = { 0: [], 1: [], 2: [], 3: [] },
                that = this;

            _.each(groups, function (g, idx) {
                g.checked = _.contains(that.cheked, g.id);
                lists[idx % 4].push(that.groupTpl(g));
            });
            this.$el.find("ul.group-column").each(function (idx, ul) {
                $(ul).html(lists[idx].join(""));
            });
        },

        filterGroups: function (evt) {
            evt.preventDefault();
            // TODO
        },

        cleanFilter: function (evt) {
            evt.preventDefault();
            // TODO
        },

        goToPage: function (evt) {
            evt.preventDefault();
            var $el = $(evt.target),
                that = this,
                page;

            if ($el.is(".previous")) {
                page = this.collection.currentPage - 1;
            } else if ($el.is(".next")) {
                page = this.collection.currentPage + 1;
            } else {
                page = parseInt($el.text(), 10);
            }
            this.collection.goTo(page, {
                success: function () { that.render(); }
            });
        }
    });
});
