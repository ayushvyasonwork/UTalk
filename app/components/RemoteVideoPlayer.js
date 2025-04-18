import React from 'react'
import { useEffect } from 'react';
export const RemoteVideoPlayer = ({ stream }) => {
    const localVideo = React.createRef();
    useEffect(() => {
        if (localVideo.current) localVideo.current.srcObject = stream;
      }, [stream, localVideo]);
  return (
    <video ref={localVideo} autoPlay playsInline />
  )
}
