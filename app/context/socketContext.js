
import React, { createContext, useContext, useState, useEffect } from 'react';
import io from 'socket.io-client';

// Create a Context for the socket
const SocketContext = createContext();

// Define a provider component
const SocketProvider = ({ children }) => {
    const [socket, setSocket] = useState(null);

    useEffect(() => {
        // Initialize the socket connection once the component mounts
        const socketInstance = io('https://localhost:5000', {
            transports: ['websocket'],
            secure: true,
            rejectUnauthorized: false,
        });

        // Store the socket instance in the state
        setSocket(socketInstance);

        // Clean up the socket when the component is unmounted
        return () => {
            if (socketInstance) {
                socketInstance.disconnect();
            }
        };
    }, []);

    return (
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    );
};

// Custom hook to access the socket
const useSocket = () => {
    const context = useContext(SocketContext);
    if (!context) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
};
export {SocketProvider,useSocket}