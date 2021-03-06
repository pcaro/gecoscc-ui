/*jslint browser: true, nomen: true, unparam: true */
/*global App, TreeModel, gettext */

// Copyright 2014 Junta de Andalucia
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

App.module("Tree", function (Tree, App, Backbone, Marionette, $, _) {
    "use strict";

    App.addInitializer(function () {
        var treeView;

        App.instances.tree = new Tree.Models.TreeModel();
        App.instances.tree.reloadTree(function () {
            App.instances.treePromise.resolve(); // tree is loaded!
        });

        treeView = new Tree.Views.NavigationTree({
            model: App.instances.tree
        });
        App.tree.show(treeView);

        App.instances.tree.on("change", function () {
            App.tree.show(treeView);
        });
    });
});

App.module("Tree.Models", function (Models, App, Backbone, Marionette, $, _) {
    "use strict";

    Models.Node = Backbone.Model.extend({
        defaults: {
            name: "AUXILIARY",
            status: "unknown"
        },

        parse: function (response) {
            response.id = response._id;
            delete response._id;
            response.status = "meta-only";
            return response;
        }
    });

    Models.Container = Backbone.Paginator.requestPager.extend({
        model: Models.Node,

        paginator_core: {
            type: "GET",
            dataType: "json",
            url: function () {
                // maxdepth must be zero for pagination to work because in the
                // answer from the server there is no information about the
                // number of children in a container (OU)
                return "/api/nodes/?maxdepth=0&path=" + this.path;
            }
        },

        paginator_ui: {
            firstPage: 0,
            currentPage: 0,
            perPage: 10,
            pagesInRange: 1,
            // 10 as a default in case your service doesn't return the total
            totalPages: 10
        },

        server_api: {
            page: function () { return this.currentPage; },
            pagesize: function () { return this.perPage; }
        },

        initialize: function (options) {
            if (!_.isString(options.path)) {
                throw "Container collections require a path attribute";
            }
            this.path = options.path;
        },

        parse: function (response) {
            this.totalPages = response.pages;
            return response.nodes;
        }
    });

    Models.TreeModel = Backbone.Model.extend({
        parser: new TreeModel(),

        defaults: {
            tree: null
        },

        getUrl: function (options) {
            var params =  ["pagesize=99999"];
            if (_.has(options, "path")) { params.push("path=" + options.path); }
            if (_.has(options, "oids")) {
                params.push("oids=" + options.oids);
            } else {
                // maxdepth messes with oids-filtered petitions
                params.push("maxdepth=0");
            }
            return "/api/nodes/?" + params.join('&');
        },

        reloadTree: function (callback) {
            var that = this;
            return $.ajax(this.getUrl({ path: "root" }), {
                success: function (response) {
                    var aux = that.parseNodesJSON(response.nodes);
                    aux[0].children[0].model.closed = false;
                    $.when.apply(that, aux[1]).done(function () {
                        that.set("tree", aux[0]);
                        if (callback) { callback(); }
                    });
                }
            });
        },

        _addPaginatedChildrenToModel: function (node) {
            var promise = $.Deferred(),
                path = node.path + ',' + node.id;
            node.paginatedChildren = new Models.Container({ path: path });
            node.paginatedChildren.goTo(0, {
                success: function () { promise.resolve(); },
                error: function () { promise.reject(); }
            });
            return promise;
        },

        parseNodesJSON: function (data) {
            var nodes, rootId, tree, promises, that;

            // Prepare the nodes to be part of the tree
            nodes = _.map(data, function (n) {
                return {
                    id: n._id,
                    path: n.path.split(','),
                    type: n.type,
                    name: n.name,
                    children: []
                };
            });
            nodes = _.sortBy(nodes, function (n) {
                return n.path.length;
            });

            // Create the tree, with only an auxiliary root node
            rootId = _.last(nodes[0].path);
            tree = this.parser.parse({
                id: rootId,
                path: _.initial(nodes[0].path).join(','),
                type: "AUXILIARY",
                name: "AUXILIARY",
                children: [],
                closed: false,
                status: "unknown"
            });

            that = this;
            promises = [];
            _.each(nodes, function (n) {
                if (n.id === rootId || n.type !== "ou") { return; }
                // Add container nodes to the tree, since they are ordered by
                // path length the parent node should always be present in the
                // tree
                var parent, parentId;

                parentId = _.last(n.path);
                n.path = n.path.join(',');
                n.closed = true;
                n.status = "paginated";
                promises.push(that._addPaginatedChildrenToModel(n));
                n = that.parser.parse(n);

                parent = tree.first(function (n) {
                    return n.id === parentId;
                });
                if (_.isUndefined(parent)) { parent = tree; }
                parent.addChild(n);
            });

            return [tree, promises];
        },

        parsePath: function (path) {
            var parsed = {
                string: path,
                array: path.split(',')
            };
            parsed.last = _.last(parsed.array);
            parsed.parentPath = _.initial(parsed.array);
            parsed.parentId = _.last(parsed.parentPath);
            return parsed;
        },

        getNodeModel: function (parentNode, oldNode, id) {
            var newNode;

            if (parentNode.model.status === "paginated") {
                newNode = parentNode.model.paginatedChildren.get(id).toJSON();
            } else if (parentNode.model.id === "root" || parentNode.model.status === "meta-only") {
                newNode = _.clone(oldNode.model);
                delete newNode.children;
            } else {
                // Parent unknown
                newNode = {
                    id: id,
                    type: "ou",
                    name: "AUXILIARY",
                    children: [],
                    closed: false,
                    status: "unknown"
                };
            }

            return newNode;
        },

        loadFromPath: function (path, silent) {
            var that, parentNode, oldNode, newNode, promises, unknownIds;

            that = this;
            path = this.parsePath(path);
            unknownIds = this.makePath(path.parentPath);

            parentNode = this.get("tree").first({ strategy: "breadth" }, function (n) {
                return n.model.id === path.parentId;
            });
            oldNode = _.find(parentNode.children, function (n) {
                return n.model.id === path.last;
            });

            newNode = this.getNodeModel(parentNode, oldNode, path.last);
            if (newNode.status === "unknown") {
                unknownIds.push(path.last);
                newNode.path = path.parentPath.join(',');
            }

            newNode.status = "paginated";
            promises = [this._addPaginatedChildrenToModel(newNode)];
            newNode = this.parser.parse(newNode);
            if (!_.isUndefined(oldNode)) {
                newNode.children = oldNode.children;
                newNode.model.children = oldNode.model.children;
                oldNode.drop();
            }
            parentNode.addChild(newNode);
            promises.push(this.resolveUnknownNodes(unknownIds, true));

            if (!silent) {
                $.when.apply($, promises).done(function () {
                    that.trigger("change");
                });
            }

            return promises;
        },

        makePath: function (path) {
            var currentNode = this.get("tree"),
                unknownIds = [],
                pathAsArray = path,
                that = this;

            if (_.isString(path)) { pathAsArray = path.split(','); }

            path = "root";
            _.each(pathAsArray, function (step) {
                if (step === "root") { return; }

                var node = currentNode.first({ strategy: "breadth" }, function (n) {
                        return n.model.id === step;
                    });

                if (_.isUndefined(node)) {
                    unknownIds.push(step);
                    node = {
                        id: step,
                        path: path,
                        type: "ou",
                        name: "AUXILIARY",
                        children: [],
                        closed: false,
                        status: "unknown"
                    };
                    node = that.parser.parse(node);
                    currentNode.addChild(node);
                }
                path += ',' + step;
                currentNode = node;
            });

            return unknownIds;
        },

        resolveUnknownNodes: function (unknownIds, silent) {
            var that = this,
                promise,
                oids;

            if (unknownIds.length === 0) {
                promise = $.Deferred();
                promise.resolve();
                return promise;
            }

            oids = unknownIds.join(',');
            return $.ajax(this.getUrl({ oids: oids })).done(function (response) {
                var tree = that.get("tree");
                _.each(response.nodes, function (n) {
                    var node = tree.first(function (item) {
                        return item.model.id === n._id;
                    });
                    node.model.name = n.name;
                    if (node.model.status !== "paginated") {
                        node.model.status = "meta-only";
                    }
                });
                if (!silent) { that.trigger("change"); }
            });
        },

        openAllContainersFrom: function (id, silent) {
            // Id must reference a container (OU)
            var node = this.get("tree").first({ strategy: 'breadth' }, function (n) {
                    return n.model.id === id;
                }),
                openedAtLeastOne;

            if (!node) { return; }

            // Include the id passed
            openedAtLeastOne = node.model.closed;
            node.model.closed = false;
            // All the ancestors
            while (node.parent) {
                openedAtLeastOne = openedAtLeastOne || node.parent.model.closed;
                node.parent.model.closed = false;
                node = node.parent;
            }

            if (openedAtLeastOne && !silent) { this.trigger("change"); }
        },

        findNodes: function (ids) {
            var tree = this.get("tree"),
                nodes = [];

            tree.walk({ strategy: 'breadth' }, function (node) {
                if (_.contains(ids, node.model.id)) {
                    nodes.push(node.model);
                }

                if (_.has(node.model, "paginatedChildren")) {
                    node.model.paginatedChildren.each(function (n) {
                        if (_.contains(ids, n.get("id"))) {
                            nodes.push(n.toJSON());
                        }
                    });
                }

                if (ids.length === nodes.length) {
                    return false;
                }
            });

            return nodes;
        },

        updateNodeById: function (id, silent) {
            // It's safe to assume in this case that the node is already
            // present in the tree (as container node or as child)
            var tree = this.get("tree"),
                node = tree.first({ strategy: 'breadth' }, function (n) {
                    return n.model.id === id;
                }),
                that = this;

            if (!_.isUndefined(node)) {
                node.model.name = "<span class='fa fa-spin fa-spinner'></span> " +
                    gettext("Loading");
                if (!silent) { this.trigger("change"); }
            }

            // Load the node new information
            $.ajax(this.getUrl({ oids: id })).done(function (response) {
                var data = response.nodes[0],
                    parent = _.last(data.path.split(','));

                node = tree.first({ strategy: 'breadth' }, function (n) {
                    return n.model.id === parent;
                });
                node = node.model.paginatedChildren.get(id);
                if (_.isUndefined(node)) {
                    // Maybe the node is not in the loaded page
                    return;
                }
                node.set("name", data.name);

                if (!silent) { that.trigger("change"); }
            });
        },

        toJSON: function () {
            var tree = this.get("tree");
            if (tree) {
                // Everything must be contained in one OU
                return _.clone(tree.model.children[0]);
            }
            return {};
        }
    });
});
