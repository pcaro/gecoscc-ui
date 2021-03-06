from pyramid.security import authenticated_userid
from pyramid.security import (Allow, Authenticated, Everyone,
                              ALL_PERMISSIONS)
from pyramid.httpexceptions import HTTPForbidden


def is_logged(request):
    return authenticated_userid(request) is not None


def api_login_required(request):
    if not is_logged(request):
        raise HTTPForbidden('Login required')


def get_user_permissions(request):
    return request.user.get('permissions', [])


def get_permissions_filter(request):
    permissions = get_user_permissions(request)
    ou_filter = []
    for ou_id in permissions:
        ous = request.db.nodes.find({'_id': ou_id})
        for ou in ous:
            if ou not in ou_filter:
                ou_filter.insert({
                    '$regex': '^{0}'.format(ou['path'])
                })

    return ou_filter


class RootFactory(object):
    __acl__ = [
        (Allow, Everyone, ALL_PERMISSIONS),
    ]

    def __init__(self, request):
        self.request = request

    def get_groups(self, userid, request):
        return []


class LoggedFactory(object):
    __acl__ = [
        (Allow, Authenticated, ALL_PERMISSIONS),
    ]

    def __init__(self, request):
        self.request = request

    def get_groups(self, userid, request):
        return []
