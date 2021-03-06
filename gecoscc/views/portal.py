import logging

from pyramid.security import remember, forget, authenticated_userid
from pyramid.httpexceptions import HTTPFound
from pyramid.renderers import render
from pyramid.response import Response

from pyramid.view import view_config, forbidden_view_config

from gecoscc.userdb import UserDoesNotExist
from gecoscc.i18n import TranslationString as _
from gecoscc.views import BaseView


logger = logging.getLogger(__name__)


@view_config(route_name='home', renderer='templates/base_tree.jinja2',
             permission='edit')
def home(context, request):
    return {}


@view_config(route_name='admins', renderer='templates/admins.jinja2',
             permission='edit')
def admins(context, request):
    return {}


@view_config(route_name='groups', renderer='templates/groups.jinja2',
             permission='edit')
def groups(context, request):
    return {}


@view_config(route_name='reports', renderer='templates/reports.jinja2',
             permission='edit')
def reports(context, request):
    return {}


#;;;;;;;;;;;
# TO DELETE
#;;;;;;;;;;;
@view_config(route_name='printers',
             renderer='templates/to_delete/printers.jinja2')
def printers(context, request):
    return {}
#;;;;;;;;;;;;;;;
# END TO DELETE
#;;;;;;;;;;;;;;;


@view_config(route_name='sockjs_home', renderer='templates/sockjs/home.jinja2',
             permission='edit')
def sockjs_home(context, request):
    return {}


class LoginViews(BaseView):

    @view_config(route_name='login', renderer='templates/login.jinja2')
    def login(self):
        if self.request.POST:
            username = self.request.POST.get('username')
            password = self.request.POST.get('password')
            try:
                user = self.request.userdb.login(username, password)
            except UserDoesNotExist:
                return {
                    'username': username,
                    'message': self.translate(
                        _("The requested username doesn't exists")),
                }

            if user is False:
                return {
                    'username': username,
                    'message': self.translate(_("The password doesn't match")),
                }

            headers = remember(self.request, username)
            self.request.session.flash(self.translate(
                _('welcome ${username}',
                  mapping={'username': user['username']})
            ))
            return HTTPFound(location=self.request.route_path('home'),
                             headers=headers)
        else:
            return {}

    @view_config(route_name='logout')
    def logout(self):
        headers = forget(self.request)
        return HTTPFound(location=self.request.route_path('login'),
                         headers=headers)


@forbidden_view_config()
@view_config(route_name='forbidden-view')
def forbidden_view(context, request):
    user = authenticated_userid(request)
    if user is not None:
        try:
            reason = context.explanation
        except AttributeError:
            reason = 'unknown'
        logger.debug("User {!r} tripped Forbidden view, request {!r}, "
                     "reason {!r}".format(user, request, reason))
        response = Response(render('templates/forbidden.jinja2', {}))
        response.status_int = 403
        return response

    if user is None and request.is_xhr:
        response = Response(render('templates/forbidden.jinja2', {}))
        response.status_int = 403
        return response

    loginurl = request.route_url('login', _query=(('next', request.path),))
    return HTTPFound(location=loginurl)
