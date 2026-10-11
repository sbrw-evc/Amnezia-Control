import asyncio
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable

log = logging.getLogger(__name__)


@dataclass
class PeriodicJob:
    name: str
    interval: Callable[[], Awaitable[float]] | float
    action: Callable[[], Awaitable[None]]
    initial_delay: float = 0


class Scheduler:
    def __init__(self):
        self._jobs: list[PeriodicJob] = []
        self._tasks: list[asyncio.Task] = []

    def add(self, job: PeriodicJob) -> None:
        self._jobs.append(job)

    def start(self) -> None:
        self._tasks = [asyncio.create_task(self._loop(j), name=j.name) for j in self._jobs]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)

    @staticmethod
    async def _loop(job: PeriodicJob) -> None:
        await asyncio.sleep(job.initial_delay)
        while True:
            try:
                await job.action()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("job %s failed", job.name)
            interval = await job.interval() if callable(job.interval) else job.interval
            await asyncio.sleep(interval)
