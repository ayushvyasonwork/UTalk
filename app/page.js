"use client"
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import io from 'socket.io-client';

export default function Home() {
    const [roomId, setRoomId] = useState('');
    const router = useRouter();

    const createRoom = () => {
        const newRoomId = Math.random().toString(36).substr(2, 9);
        router.push(`/meeting/${newRoomId}`);
    };

    const joinRoom = () => {
        if (roomId) router.push(`/meeting/${roomId}`);
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen">
            <h1 className="text-2xl mb-4">Google Meet Clone</h1>
            <button className="px-4 py-2 bg-blue-500 text-white rounded" onClick={createRoom}>
                Create Room
            </button>
            <input 
                className="border px-2 py-1 mt-4" 
                type="text" 
                placeholder="Enter Room ID" 
                value={roomId} 
                onChange={(e) => setRoomId(e.target.value)}
            />
            <button className="px-4 py-2 bg-green-500 text-white rounded mt-2" onClick={joinRoom}>
                Join Room
            </button>
        </div>
    );
}


