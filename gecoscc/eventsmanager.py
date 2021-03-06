import logging

from datetime import datetime

from pyramid.security import authenticated_userid
from pyramid_sockjs.session import Session

from gecoscc.models import JOB_STATUS

logger = logging.getLogger(__name__)

CHANNELS = {
    'admin': ('admin', ),
}


class JobStorage(object):

    class JobDoesNotExist(Exception):
        pass

    class JobAlreadyExists(Exception):
        pass

    class StatusInvalidException(Exception):
        pass

    class JobOperationForbidden(Exception):
        pass

    def __init__(self, collection, userdb, user):
        self.collection = collection
        self.userdb = userdb
        self.user = user

    def check_permissions(self, jobid):
        # TODO
        if self.user is None:
            return False

        return True

    def assert_permissions(self, jobid):
        # TODO
        # Raise a forbidden exception is not allowed
        if not self.check_permissions(jobid):
            raise self.JobOperationForbidden()

    def create(self, jobid, objid=None, type=None, op=None):

        self.assert_permissions(jobid)
        userid = self.user['_id']

        if objid is None or type is None or op is None:
            raise ValueError('objid, type and op are required')

        if self.collection.find_one({
            '_id': jobid
        }):
            raise self.JobAlreadyExists()

        job = {
            '_id': jobid,
            'userid': userid,
            'objid': objid,
            'type': type,
            'op': op,
            'created': datetime.utcnow(),
            'last_update': datetime.utcnow(),
        }

        self.collection.insert(job)

    def update_status(self, jobid, status):

        self.assert_permissions(jobid)

        job = self.collection.find_one({
            '_id': jobid
        })

        if status not in JOB_STATUS:
            raise self.StatusInvalidException()
        if not job:
            raise self.JobDoesNotExist()

        self.collection.update({
            '_id': jobid,
        }, {
            '$set': {
                'status': status,
                'last_update': datetime.utcnow(),
            }
        })

    def get(self, jobid):

        self.assert_permissions(jobid)

        job = self.collection.find_one({
            '_id': jobid
        })

        if not job:
            raise self.JobDoesNotExist()

        return job


def get_jobstorage(request):
    if request.is_logged:
        user = request.user
    else:
        user = None
    return JobStorage(request.db.jobs, request.userdb, user)


class EventsManager(Session):

    def on_open(self):
        self.send('Hello')
        self.manager.broadcast("Someone joined.")

    def on_message(self, message):
        userid = authenticated_userid(self.request)
        if userid is None:
            logger.warning("Unsecure message procedence!!!")
            return
        message = "{0}: {1}".format(userid, message)
        users = CHANNELS[userid]
        for session in self.manager.active_sessions():
            if (session.request.user and
                    session.request.user['username'] in users):
                session.send(message)
            else:
                logger.warning("Unsecure socket connection!!!")

    def on_close(self):
        self.manager.broadcast("Someone left.")
