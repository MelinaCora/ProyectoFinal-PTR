import asyncio
import logging

from fastapi import WebSocket, WebSocketDisconnect


LOGGER = logging.getLogger(__name__)
CLIENT_QUEUE_CAPACITY = 32


class WebSocketHub:
    def __init__(self, snapshot_provider, queue_capacity=CLIENT_QUEUE_CAPACITY):
        self.snapshot_provider = snapshot_provider
        self.queue_capacity = queue_capacity
        self._loop = None
        self._clients = set()

    def bind(self):
        self._loop = asyncio.get_running_loop()

    def unbind(self):
        self._clients.clear()
        self._loop = None

    def publish(self, message):
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._publish_on_loop, message)
        except RuntimeError:
            LOGGER.debug("Se descartó una notificación durante el cierre del event loop")

    def _publish_on_loop(self, message):
        for client, queue in tuple(self._clients):
            if queue.full():
                try:
                    queue.get_nowait()
                    LOGGER.warning("Se descartó el mensaje WebSocket más antiguo para un cliente lento")
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                LOGGER.warning("Se descartó una notificación para un cliente WebSocket lento")

    async def serve(self, websocket: WebSocket):
        await websocket.accept()
        queue = asyncio.Queue(maxsize=self.queue_capacity)
        queue.put_nowait({"type": "snapshot", "data": self.snapshot_provider()})
        client = (websocket, queue)
        self._clients.add(client)
        receive_task = asyncio.create_task(websocket.receive())
        queue_task = None
        try:
            while True:
                queue_task = asyncio.create_task(queue.get())
                done, _ = await asyncio.wait(
                    {receive_task, queue_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if receive_task in done:
                    frame = receive_task.result()
                    if frame["type"] == "websocket.disconnect":
                        break
                    await websocket.close(
                        code=1008, reason="El canal es de solo observación"
                    )
                    break
                message = queue_task.result()
                queue_task = None
                await websocket.send_json(message)
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        except (OSError, RuntimeError):
            LOGGER.exception("Error enviando datos al cliente WebSocket")
        finally:
            for task in (receive_task, queue_task):
                if task is not None and not task.done():
                    task.cancel()
            self._clients.discard(client)

    @property
    def client_count(self):
        return len(self._clients)

    def queued_messages(self, websocket):
        for client, queue in self._clients:
            if client is websocket:
                return queue.qsize()
        return None
