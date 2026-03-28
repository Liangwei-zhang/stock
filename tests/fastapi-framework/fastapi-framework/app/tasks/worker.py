"""
Arq background worker settings.

To add a background task:
    1. Define an async function in app/tasks/tasks.py:
           async def my_task(ctx, arg1, arg2): ...
    2. Add it to the `functions` list below.
    3. Enqueue from anywhere:
           from app.core.worker import get_worker_pool
           pool = await get_worker_pool()
           await pool.enqueue_job("my_task", arg1, arg2)

Run the worker:
    arq app.tasks.worker.WorkerSettings
"""
from arq.connections import RedisSettings

from app.core.config import get_settings

settings = get_settings()


class WorkerSettings:
    redis_settings        = RedisSettings.from_dsn(settings.REDIS_URL)
    functions             = []          # add your task functions here
    job_timeout           = 300         # seconds
    max_tries             = 3
    retry_delay           = 10
    health_check_interval = 60
