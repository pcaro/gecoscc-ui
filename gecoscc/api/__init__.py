from bson import ObjectId
from copy import deepcopy

from pymongo.errors import DuplicateKeyError

from cornice.schemas import CorniceSchema

from pyramid.httpexceptions import HTTPNotFound, HTTPBadRequest

from gecoscc.tasks import object_created, object_changed, object_deleted


SAFE_METHODS = ('GET', 'OPTIONS', 'HEAD',)
UNSAFE_METHODS = ('POST', 'PUT', 'PATCH', 'DELETE', )
SCHEMA_METHODS = ('POST', 'PUT', )


class ResourcePaginatedReadOnly(object):
    # TODO
    # Implement permissions filter

    schema_collection = None
    schema_detail = None
    mongo_filter = {
        'type': 'anytype',
    }
    collection_name = 'nodes'
    objtype = None
    key = '_id'

    def __init__(self, request):
        self.request = request
        self.default_pagesize = request.registry.settings.get(
            'default_pagesize', 30)
        self.collection = self.get_collection()
        if self.objtype is None:
            raise self.BadResourceDefinition('objtype is not defined')

    class BadResourceDefinition(Exception):
        pass

    def parse_item(self, item):
        return self.schema_detail().serialize(item)

    def parse_collection(self, collection):
        return self.schema_collection().serialize(collection)

    def get_objects_filter(self):
        query = []
        if not self.request.method == 'GET':
            return []
        if 'name' in self.request.GET:
            query.append({
                'name': self.request.GET.get('name')
            })

        if 'iname' in self.request.GET:
            query.append({
                'name': {
                    '$regex': '.*{0}.*'.format(self.request.GET.get('iname'))
                },
            })

        return query

    def get_object_filter(self):
        return {}

    def get_oid_filter(self, oid):
        return {self.key: ObjectId(oid)}

    def get_collection(self, collection=None):
        if collection is None:
            collection = self.collection_name
        return self.request.db[collection]

    def collection_get(self):
        page = int(self.request.GET.get('page', 0))
        pagesize = int(self.request.GET.get('pagesize', self.default_pagesize))

        extraargs = {}
        if pagesize > 0:
            extraargs.update({
                'skip': page * pagesize,
                'limit': pagesize,
            })

        objects_filter = self.get_objects_filter()
        if self.mongo_filter:
            objects_filter.append(self.mongo_filter)

        mongo_query = {
            '$and':  objects_filter
        }

        nodes_count = self.collection.find(
            mongo_query,
            {'type': 1}
        ).count()

        objects = self.collection.find(mongo_query, **extraargs)
        if pagesize > 0:
            pages = int(nodes_count / pagesize)
        else:
            pagesize = 1
        parsed_objects = self.parse_collection(list(objects))
        return {
            'pagesize': pagesize,
            'pages': pages,
            'page': page,
            self.collection_name: parsed_objects,
        }

    def get(self):
        oid = self.request.matchdict['oid']
        collection_filter = self.get_oid_filter(oid)
        collection_filter.update(self.get_object_filter())
        collection_filter.update(self.mongo_filter)
        node = self.collection.find_one(collection_filter)
        if not node:
            raise HTTPNotFound()

        return self.parse_item(node)


class ResourcePaginated(ResourcePaginatedReadOnly):

    def __init__(self, request):
        super(ResourcePaginated, self).__init__(request)
        if request.method == 'POST':
            schema = self.schema_detail()
            del schema['_id']
            self.schema = CorniceSchema(schema)

        elif request.method == 'PUT':
            self.schema = CorniceSchema(self.schema_detail)
            # Implement write permissions

    def integrity_validation(self, obj, real_obj=None):
        return True

    def pre_save(self, obj, old_obj=None):
        return obj

    def post_save(self, obj, old_obj=None):
        return obj

    def pre_delete(self, obj, old_obj=None):
        return obj

    def post_delete(self, obj, old_obj=None):
        return obj

    def collection_post(self):
        obj = self.request.validated

        if not self.integrity_validation(obj):
            if len(self.request.errors) < 1:
                self.request.errors.add('body', 'object', 'Integrity error')
            return

        # Remove '_id' for security reasons
        if self.key in obj:
            del obj[self.key]

        obj = self.pre_save(obj)

        try:
            obj_id = self.collection.insert(obj)
        except DuplicateKeyError, e:
            raise HTTPBadRequest('The Object already exists: '
                                 '{0}'.format(e.message))

        obj = self.post_save(obj)

        obj.update({self.key: obj_id})
        self.notify_created(obj)
        return self.parse_item(obj)

    def _job_params(self, obj, op):

        if self.objtype == 'group':
            type = 'group'
        else:
            type = 'node'

        params = {
            'type': type,
            'objid': obj['_id'],
            'op': op,
        }

        return params

    def notify_created(self, obj):
        result = object_created.delay(self.objtype, obj)

        params = self._job_params(obj, 'created')

        self.request.jobs.create(result.task_id, **params)

    def notify_changed(self, obj, old_obj):
        result = object_changed.delay(self.objtype, obj, old_obj)

        params = self._job_params(obj, 'changed')

        self.request.jobs.create(result.task_id, **params)

    def notify_deleted(self, obj):
        result = object_deleted.delay(self.objtype, obj)

        params = self._job_params(obj, 'deleted')

        self.request.jobs.create(result.task_id, **params)

    def put(self):
        obj = self.request.validated
        oid = self.request.matchdict['oid']

        if oid != str(obj[self.key]):
            raise HTTPBadRequest('The object id is not the same that the id in'
                                 ' the url')

        obj_filter = self.get_oid_filter(oid)
        obj_filter.update(self.mongo_filter)

        real_obj = self.collection.find_one(obj_filter)
        if not real_obj:
            raise HTTPNotFound()
        old_obj = deepcopy(real_obj)
        if not self.integrity_validation(obj, real_obj=real_obj):
            if len(self.request.errors) < 1:
                self.request.errors.add('body', 'object', 'Integrity error')
            return

        obj = self.pre_save(obj, old_obj=old_obj)

        real_obj.update(obj)

        try:
            self.collection.update(obj_filter, real_obj, new=True)
        except DuplicateKeyError, e:
            raise HTTPBadRequest('Duplicated object {0}'.format(
                e.message))

        obj = self.post_save(obj, old_obj=old_obj)

        self.notify_changed(old_obj, obj)

        return self.parse_item(obj)

    def delete(self):

        obj_id = self.request.matchdict['oid']

        filter = self.get_oid_filter(obj_id)
        filter.update(self.mongo_filter)

        obj = self.collection.find_one(filter)
        if not obj:
            raise HTTPNotFound()
        old_obj = deepcopy(obj)

        if not self.integrity_validation(obj):
            if len(self.request.errors) < 1:
                self.request.errors.add('body', 'object', 'Integrity error')
            return

        obj = self.pre_save(obj)
        obj = self.pre_delete(obj)

        status = self.collection.remove(filter)

        if status['ok']:
            obj = self.post_save(obj, old_obj)
            obj = self.post_delete(obj)

            self.notify_deleted(obj)
            return {
                'status': 'The object was deleted successfully',
                'ok': 1
            }
        else:
            self.request.errors.add(unicode(obj[self.key]), 'db status',
                                    status)
            return


class TreeResourcePaginated(ResourcePaginated):

    def integrity_validation(self, obj, real_obj=None):
        """ Test that the object path already exist """

        if real_obj is not None and obj['path'] == real_obj['path']:
            # This path was already verified before
            return True

        parents = obj['path'].split(',')

        parent_id = parents[-1]

        if parent_id == 'root':
            return True

        parent = self.collection.find_one({self.key: ObjectId(parent_id)})
        if not parent:
            self.request.errors.add(unicode(obj[self.key]), 'path', "parent"
                                    " doesn't exist {0}".format(parent_id))
            return False

        candidate_path_parent = ','.join(parents[:-1])

        if parent['path'] != candidate_path_parent:
            self.request.errors.add(
                unicode(obj[self.key]), 'path', "the parent object "
                "{0} has a different path".format(parent_id))
            return False

        return True


class TreeLeafResourcePaginated(TreeResourcePaginated):

    def check_memberof_integrity(self, obj):
        """ Check if memberof ids already exists"""
        if 'memberof' not in obj:
            return True

        for group_id in obj['memberof']:
            group = self.request.db.nodes.find_one({'_id': group_id})
            if not group:
                self.request.errors.add(
                    unicode(obj[self.key]), 'memberof',
                    "The group {0} doesn't exist".format(unicode(group_id)))
                return False

        return True

    def integrity_validation(self, obj, real_obj=None):
        result = super(TreeLeafResourcePaginated, self).integrity_validation(
            obj, real_obj)
        result = result and self.check_memberof_integrity(obj)
        return result

    def post_save(self, obj, old_obj=None):

        if self.request.method == 'DELETE':
            newmemberof = []
        else:
            newmemberof = obj.get('memberof', [])
        if old_obj is not None:
            oldmemberof = old_obj.get('memberof', [])
        else:
            oldmemberof = []

        adds = [n for n in newmemberof if n not in oldmemberof]
        removes = [n for n in oldmemberof if n not in newmemberof]

        for group_id in removes:
            self.request.db.nodes.update({
                '_id': group_id
            }, {
                '$pull': {
                    'members': obj['_id']
                }
            }, multi=False)

        for group_id in adds:

            # Add newmember to new group
            self.request.db.nodes.update({
                '_id': group_id
            }, {
                '$push': {
                    'members': obj['_id']
                }
            }, multi=False)

        return super(TreeLeafResourcePaginated, self).post_save(obj, old_obj)
