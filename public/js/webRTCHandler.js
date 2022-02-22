import * as wss from "./wss.js";
import * as constants from "./constants.js";
import * as ui from "./ui.js";
import * as store from "./store.js";


let connectedUserDetails;
let peerConnection;
let dataChannel;
let screenSharingStream;

const defaultConstraints = {
    audio: true,
    video: true
}

const configuration = {
    iceServers: [
        {
            urls: "stun:stun.1.google.com:13902"
        }
    ]
}

export const getLocalPreview = () => {
    navigator.mediaDevices.getUserMedia(defaultConstraints)
        .then(stream => {
            ui.updateLocalVideo(stream)
            ui.showVideoCallButtons()
            store.setCallState(constants.callState.CALL_AVAILABLE)
            store.setLocalStream(stream)
        }).catch(error => {
        console.log('Error occured when trying to get an access to camera')
        console.log(error)
    })
}

export const createPeerConnection = () => {
    peerConnection = new RTCPeerConnection(configuration)

    dataChannel = peerConnection.createDataChannel('chat')

    peerConnection.ondatachannel = event => {
        const dataChannel = event.channel
        dataChannel.onopen = () => {

        }
        dataChannel.onmessage = event => {
            const message = JSON.parse(event.data)
            ui.appendMessage(message)
        }
    }

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            // send our ice candidates
            wss.sendDataUsingWebRTCSignaling({
                connectedUserSocketId: connectedUserDetails.socketId,
                type: constants.webRTCSignaling.ICE_CANDIDATE,
                candidate: event.candidate,
            })
        }
    }
    peerConnection.onconnectionstatechange = event => {
        if (peerConnection.connectionState === "connected") {

        }
    }

    // receiving tracks
    const remoteStream = new MediaStream()
    store.setRemoteStream(remoteStream)
    ui.updateRemoteVideo(remoteStream)

    peerConnection.ontrack = event => {
        remoteStream.addTrack(event.track)
    }

    // add our stream to peer connection
    if (connectedUserDetails.callType === constants.callType.VIDEO_PERSONAL_CODE || connectedUserDetails.callType === constants.callType.VIDEO_STRANGER) {
        const localStream = store.getState().localStream

        for (const track of localStream.getTracks()) {
            peerConnection.addTrack(track, localStream)
        }
    }

}

export const sendMessageUsingDataChannel = (message) => {
    const stringifyMessage = JSON.stringify(message)
    dataChannel.send(stringifyMessage)

}

export const sendPreOffer = (callType, calleePersonalCode) => {
    connectedUserDetails = {
        socketId: calleePersonalCode,
        callType
    }
    if (callType === constants.callType.CHAT_PERSONAL_CODE || callType === constants.callType.VIDEO_PERSONAL_CODE) {
        const data = {
            callType,
            calleePersonalCode,
        }
        ui.showCallingDialog(callingDialogRejectCallHandler)
        store.setCallState(constants.callState.CALL_UNAVAILABLE)
        wss.sendPreOffer(data)
    }

    if (callType === constants.callType.CHAT_STRANGER || callType === constants.callType.VIDEO_STRANGER)
    {
        const data = {
            callType,
            calleePersonalCode,
        }

        store.setCallState(constants.callState.CALL_UNAVAILABLE)
        wss.sendPreOffer(data)
    }

};

export const handlePreOffer = (data) => {
    const {callerSocketId, callType} = data;

    if (!checkCallPossibility()) {
        return sendPreOfferAnswer(constants.preOfferAnswer.CALL_UNAVAILABLE, callerSocketId)
    }
    connectedUserDetails = {
        socketId: callerSocketId,
        callType
    }

    store.setCallState(constants.callState.CALL_UNAVAILABLE)

    if (callType === constants.callType.CHAT_PERSONAL_CODE || callType === constants.callType.VIDEO_PERSONAL_CODE) {
        ui.showIncomingCallDialog(callType, acceptCallHandler, rejectCallHandler)
    }
    if (callType === constants.callType.CHAT_STRANGER || callType === constants.callType.VIDEO_STRANGER)
    {
        createPeerConnection()
        sendPreOfferAnswer(constants.preOfferAnswer.CALL_ACCEPTED)
        ui.showCallElements(connectedUserDetails.callType)
    }
}

const acceptCallHandler = () => {
    createPeerConnection()
    sendPreOfferAnswer(constants.preOfferAnswer.CALL_ACCEPTED)
    ui.showCallElements(connectedUserDetails.callType)

}
const rejectCallHandler = () => {
    setIncomingCallsAvailable()
    sendPreOfferAnswer(constants.preOfferAnswer.CALL_REJECTED)
}

const callingDialogRejectCallHandler = () => {
    const data = {
        connectedUserSocketId: connectedUserDetails.socketId
    }
    closePeerConnectionAndResetState()
    wss.sendUserHangUp(data)
}

const sendPreOfferAnswer = (preOfferAnswer, callerSocketId = null) => {
    const socketId = callerSocketId ? callerSocketId : connectedUserDetails.socketId
    const data = {
        callerSocketId: socketId,
        preOfferAnswer
    }
    ui.removeAllDialogs()
    wss.sendPreOfferAnswer(data)
}

export const handlePreOfferAnswer = (data) => {
    const {preOfferAnswer} = data
    ui.removeAllDialogs()

    if (preOfferAnswer === constants.preOfferAnswer.CALLEE_NOT_FOUND) {
        ui.showInfoDialog(preOfferAnswer)
        setIncomingCallsAvailable()
        // show Dialog that Callee has not been found
    }
    if (preOfferAnswer === constants.preOfferAnswer.CALL_UNAVAILABLE) {
        setIncomingCallsAvailable()
        ui.showInfoDialog(preOfferAnswer)
        // show Dialog that Callee is not Able to connect
    }
    if (preOfferAnswer === constants.preOfferAnswer.CALL_REJECTED) {
        setIncomingCallsAvailable()
        ui.showInfoDialog(preOfferAnswer)
        // show Dialog that call is rejected by the Callee
    }
    if (preOfferAnswer === constants.preOfferAnswer.CALL_ACCEPTED) {
        ui.showCallElements(connectedUserDetails.callType)
        createPeerConnection()
        sendWebRTCOffer()
        // show Dialog that call is accepted by the Callee

    }
}
const sendWebRTCOffer = async () => {
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    wss.sendDataUsingWebRTCSignaling({
        connectedUserSocketId: connectedUserDetails.socketId,
        type: constants.webRTCSignaling.OFFER,
        offer
    })
}

export const handleWebRTCOffer = async (data) => {
    await peerConnection.setRemoteDescription(data.offer)
    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)
    wss.sendDataUsingWebRTCSignaling({
        connectedUserSocketId: connectedUserDetails.socketId,
        type: constants.webRTCSignaling.ANSWER,
        answer
    })
}
export const handleWebRTCAnswer = async (data) => {
    await peerConnection.setRemoteDescription(data.answer)
    // const answer = await peerConnection.createAnswer()
    // await peerConnection.setLocalDescription(answer)
    // wss.sendDataUsingWebRTCSignaling({
    //     connectedUserSocketId: connectedUserDetails.socketId,
    //     type: constants.webRTCSignaling.ANSWER,
    //     answer
    // })
}

export const handleWebRTCCandidate = async (data) => {
    try {
        await peerConnection.addIceCandidate(data.candidate)
    } catch (error) {
        console.error("Error occured when trying to add received ice candidate", error)
    }
}

export const switchBetweenCameraAndScreenSharing = async (screenSharingActive) => {
    if (screenSharingActive) {
        const localStream = store.getState().localStream
        const senders = peerConnection.getSenders()
        const sender = senders.find(sender => sender.track.kind === localStream.getVideoTracks()[0].kind)
        if (sender) sender.replaceTrack(localStream.getVideoTracks()[0])

        // Stop Screen sharing stream
        store.getState().screenSharingStream.getTracks().forEach(track => track.stop())
        store.setScreenSharingActive(!screenSharingActive)
        ui.updateLocalVideo(localStream)
    } else {
        try {
            screenSharingStream = await navigator.mediaDevices.getDisplayMedia({video: true})
            store.setScreenSharingStream(screenSharingStream)
            // replace track which sender is sending
            const senders = peerConnection.getSenders()
            const sender = senders.find(sender => sender.track.kind === screenSharingStream.getVideoTracks()[0].kind)
            if (sender) sender.replaceTrack(screenSharingStream.getVideoTracks()[0])
            store.setScreenSharingActive(!screenSharingActive)
            ui.updateLocalVideo(screenSharingStream)
        } catch (error) {
            console.error('error occured when trying to get screen sharing stream', error)
        }
    }
}


// hang up

export const handleHangUp = () => {
    const data = {
        connectedUserSocketId: connectedUserDetails.socketId
    }
    wss.sendUserHangUp(data)
    closePeerConnectionAndResetState()
}

export const handleConnectedUserHangedUp = () => {
    closePeerConnectionAndResetState()
}

const closePeerConnectionAndResetState = () => {
    if (peerConnection) {
        peerConnection.close()
        peerConnection = null
    }

    // active mic and camera
    if (connectedUserDetails.callType === constants.callType.VIDEO_PERSONAL_CODE || connectedUserDetails.callType === constants.callType.VIDEO_STRANGER) {
        store.getState().localStream.getVideoTracks()[0].enabled = true;
        store.getState().localStream.getAudioTracks()[0].enabled = true;

    }
    ui.updateUIAfterHangUp(connectedUserDetails.callType)
    setIncomingCallsAvailable()
    connectedUserDetails = null
}


const checkCallPossibility = (callType) => {
    const callState = store.getState().callState

    if (callState === constants.callState.CALL_AVAILABLE) {
        return true
    }

    if ((
        callType === constants.callType.VIDEO_PERSONAL_CODE ||
        callType === constants.callType.VIDEO_STRANGER
    ) && callState === constants.callState.CALL_AVAILABLE_ONLY_CHAT) {
        return false;
    }

    return false;
}

const setIncomingCallsAvailable = () => {
    const localStream = store.getState().localStream
    if (localStream) {
        store.setCallState(constants.callState.CALL_AVAILABLE)
    } else {
        store.setCallState(constants.callState.CALL_AVAILABLE_ONLY_CHAT)
    }
}





