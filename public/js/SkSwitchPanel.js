/*
 * Copyright 2021 Paul Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const pluginDataSwLabels = []
const pluginDataId = 'skswitches'
const pluginDataPath = "/signalk/v1/applicationData/global/skswitches/1.0.0"
const indicatorColourOn = "#00a651"
const indicatorColourOff = "0c1927"
const noDeltaTimeoutTime = 11000
const numberOfSwitches = 8
const skSocketKeepaliveIntervalMs = 10000
const skSocketTimeoutReconnect = 500
const skSocketReconnect = true
const skUserName = "webapp"
const skUserPassword = "fedcba9876"
//"NMEA2000", "SensESP", "Rpi-I2c"]

var currentSwitchState = 0x00
var noDeltaTimerHandle = null
var noDeltaTimedOut = false
var pluginDataInstance = 0
var pluginDataEnabled = false
var pluginDataReady = false
var pluginDataPanelName = ''
var pluginDatatype = 'NMEA2000'
var skSocketIsconnected = false
var skSocketlastMessage = -1
var skSocket = null


var subscriptionObjectN2K = {
  "context": "vessels.*",
  "subscribe": [{
    "path": "electrical.switches.bank." + pluginDataInstance.toString() + ".*.state"
  }]
};
var subscriptionObjectSensESP = {
  "context": "vessels.*",
  "subscribe": [{
    "path": "electrical.switches.*.state"
  }]
};
/*
 ** It all starts here
 */

window.onload = function () {
  console.log(window.location.host)
  // window.location.protocol
  connectToSkServer()
  setSwitchClickEventListeners()
  setAllSwitchesEnabled(true)
  setAllToCurrentState()
  noDeltaTimerHandle = setTimeout(updateTimeOutTimerCb, noDeltaTimeoutTime);
}

window.onbeforeunload = function (event) {

}

/*
 ** returns the switch ID string
 */

function findSwitchIdStr(swIdIndex) {
  return (swIdIndex.toString())
}

/*
 ** change the state of current switch state
 */

function setSwByIndexAndState(index, state) {
  if ((index < numberOfSwitches) && (state <= 1)) {
    var mask = 0x01
    mask = mask << index
    if (state == 1)
      currentSwitchState = currentSwitchState | mask
    else
      currentSwitchState = currentSwitchState & (~mask)
    setAllToCurrentState()
  }
}

/*
 ** set all switches active (true) or offline (false)
 */

function setAllSwitchesEnabled(state) {
  for (var index = 1; index < numberOfSwitches + 1; index++) {
    var element = findSwitchIdStr(index)
    var mSwitchId = document.getElementById(element)
    if (state == false) {
      mSwitchId.disabled = true
      document.getElementById("in" + element).innerHTML = "Off line";
    } else {
      mSwitchId.disabled = false
      document.getElementById("in" + element).innerHTML = "Ok";
    }
    document.getElementById("in" + element).style.background = "#0c1927"
  }
}

/*
 ** set the each switch displayed to off state
 */

var resetAllSwitches = function () {
  for (index = 1; index < numberOfSwitches + 1; index++) {
    element = findSwitchIdStr(index)
    var mSwitchId = document.getElementById(element);
    mSwitchId.checked = false
  }
}

/*
 ** set the switch display to reflect the current state
 */

var setAllToCurrentState = function () {
  var mask = 0x01;
  var swNumber = 1
  for (var index = 1; index < numberOfSwitches + 1; index++) {
    var element = findSwitchIdStr(index)
    var mSwitchId = document.getElementById(element)
    if (currentSwitchState & mask) {
      mSwitchId.checked = true
      setIndicatorColour(index, indicatorColourOn)
      setIndicatorText(index, "OK")
    } else {
      mSwitchId.checked = false
      setIndicatorColour(index, "0c1927")
      setIndicatorText(index, "OK")
    }
    mask = mask << 1
    swNumber++
  };
}

/*
 ** Set indicator colour
 */

function setIndicatorColour(switchNumber, hex) {
  let id = findSwitchIdStr(switchNumber)
  document.getElementById("in" + id).style.background = (document.getElementById(id).checked === true ? hex : "")
}

/*
 ** Set/display indicator state text
 */

function setIndicatorText(switchNumber, text) {
  let id = findSwitchIdStr(switchNumber)
  document.getElementById("in" + id).innerHTML = text;
}

/*
 ** setup switch change liseners
 */

function setSwitchClickEventListeners() {
  for (let i = 1; i <= numberOfSwitches; i++)
    document.getElementById(i.toString()).onclick = function () {
      switchClick(i.toString())
    };
}

/*
 ** a switch has changed state, decode and get ready for transmission
 */

function switchClick(switchNumber) {
  var str = findSwitchIdStr(switchNumber)
  var mSwitchId = document.getElementById(str)
  var swChecked = mSwitchId.checked
  if (swChecked == false) {
    setIndicatorColour(switchNumber, indicatorColourOff)
    setIndicatorText(switchNumber, "OK")
    var swState = 0
  } else {
    setIndicatorColour(switchNumber, indicatorColourOn)
    setIndicatorText(switchNumber, "OK")
    swState = 1
  }
  sendSwChange(pluginDataInstance, switchNumber, swState)
}


/*
 ** a switch has changed state, send out to the "end point" i.e the HW
 */

var sendSwChange = function (swInstance, swNumber, swState) {

  const swCmdMsg = { "path": "electrical.switches.SkSwitches", "value": { "swInstance": swInstance, "swSwitch": swNumber, "State": swState, } }
  var cmdJson = '{"context":"vessels.self","requestId":"184743-434373-348483","put":' + JSON.stringify(swCmdMsg) + '}'
  setIndicatorText(swNumber, "Pending")
  console.log(cmdJson)
  skSocket.send(cmdJson)
}

/*
 ** a switch delta has arrived to process
 */

var decodeSwDeltas = function (skDelta) {
  {
    // console.log(skDelta)
    for (var key in skDelta) {
      if (key == "updates") {
        var values = skDelta[key][0]['values'];
        // console.log(values)
        for (var tuple in values) {
          var path = values[tuple]['path']
          //console.log(path)
          if (pluginDatatype == 'NMEA2000') {
            path.indexOf("locate")
            var SwitchInstance = parseInt(path.split(".")[3])
            var SwitchId = parseInt(path.split(".")[4]) // get switch number and convert to an integer
            var value = values[tuple]['value']
          } else {
            var switchName = path.split(".")[2]
            var SwitchId = pluginDataSwLabels.indexOf(switchName)
            if (SwitchId == -1) return -1
            var value = values[tuple]['value']
            SwitchId++
            // console.log(switchName)
            // console.log(value)
            var SwitchInstance = pluginDataInstance
          }
        }
        if (SwitchInstance === pluginDataInstance) {
          if (noDeltaTimedOut === true) {
            noDeltaTimedOut = false
            setAllSwitchesEnabled(true)
            setAllToCurrentState()
          }
          setSwByIndexAndState(SwitchId - 1, value);
          clearTimeout(noDeltaTimerHandle)
          noDeltaTimerHandle = setTimeout(updateTimeOutTimerCb, noDeltaTimeoutTime);
        }
      }
    }
  }
  if (skDelta.hasOwnProperty('alert')) {
    console.log('alert :', skDelta);
  }
}


/*
 ** If no switch deltas are received and the timeout timer "times out"
 */

function updateTimeOutTimerCb() {
  resetAllSwitches()
  setAllSwitchesEnabled(false)
  noDeltaTimedOut = true
}

/*
 ** get config data from the SK server plugin
 */

async function getPluginData() {

  try {
    const response = await fetch(pluginDataPath)
    if (!response.ok) {
      const message = 'Error with Status Code: ' + response.status;
      console.log(message)
      pluginDataReady = false
      return
    }
    const data = await response.json()
    var pluginsData = data
  } catch (error) {
    console.log('Error: ' + err)
    return
  }
  panelName = pluginsData["panelName"]
  pluginDataInstance = pluginsData["instance"]
  pluginDatatype = pluginsData["type"]
  pluginDatachannels = pluginsData["channels"]
  for (index = 0; index < Object.keys(pluginDatachannels).length; index++) {
    pluginDataSwLabels[index] = pluginDatachannels[(index + 1).toString()]["label"]
  }
  pluginDataSwLabels.forEach((label, index) => {
    document.getElementById("label" + (index + 1).toString()).innerHTML = label
  })
  console.log(panelName)
  document.getElementById("vesselName").innerHTML = panelName
  pluginDataReady = true
}

/*
 ** Make all connections to SignalK server and get plug data
 */

async function connectToSkServer() {
  await authenticate();  // wait until authentication process finished
  await getPluginData(); // get plugin schema data and decode 
  openSocket()
}

/*
 ** Athenticate user with the server
 */

async function authenticate() {

  const authRequest = {
    method: 'POST',
    mode: 'cors',
    credentials: 'same-origin',
    body: JSON.stringify({
      username: skUserName,
      password: skUserPassword,
    }),
    headers: {
      Accept: "application/json",
      'Content-Type': "application/json"
    }
  }
  URI = '/signalk/v1/auth/login'
  try {
    const response = await fetch(URI, authRequest);
    if (!response.ok) {
      isAuthenticated = false
      token = null
      const message = 'Error with Status Code: ' + response.status;
      throw new Error(message);
    }
    const data = await response.json()
    if (!data || typeof data !== 'object' || !data.hasOwnProperty('token')) {
      console.log("Unexpected response");
      isAuthenticated = false
      token = null
      return (data)
    } else {
      //console.log(data)
      token = data.token
      isAuthenticated = true
      return data
    }
  } catch (error) {
    console.log('Error: ' + err);
  }
}

/*
 ** Socket connection for receiving subscribed deltas and sending switch change msgs.
 */

function openSocket() {

  if (skSocket === null && skSocketIsconnected === false) {
    try {
      skSocket = new WebSocket((window.location.protocol === 'https:' ? 'wss' : 'ws')
        + "://" + window.location.host + "/signalk/v1/stream?subscribe=none")
      skSocket.addEventListener('open', skSocketOpen)
      skSocket.addEventListener('close', skSocketClose)
      skSocket.addEventListener('message', skSocketMessage)
      skSocket.addEventListener('error', skSocketError)
    }
    catch (exception) {
      console.error(exception)
      skSocketIsconnected = false
      skSocket = null
      setTimeout(() => openSocket(), skSocketTimeoutReconnect)
    }
  }
}

function skSocketOpen() {
  skSocketIsconnected = true;

  if (pluginDatatype == 'NMEA2000')
    subscriptionMessage = JSON.stringify(subscriptionObjectN2K);
  else
    subscriptionMessage = JSON.stringify(subscriptionObjectSensESP);
  skSocket.send(subscriptionMessage);
  skSocketKeepAlive()
}

function skSocketClose() {
  skSocket.removeEventListener('open', skSocketOpen)
  skSocket.removeEventListener('close', skSocketClose)
  skSocket.removeEventListener('message', skSocketMessage)
  skSocket.removeEventListener('error', skSocketError)
  skSocket = null
  skSocketIsconnected = false;
}

function skSocketError(err) {
  console.log('[skSocket error]: ', err.message)
  if (skSocketReconnect === true) {
    skSocketIsconnected = false;
    setTimeout(() => openSocket(), skSocketTimeoutReconnect)
  }

}


function skSocketMessage(event) {
  var skMessage = JSON.parse(event.data)
  if (typeof skMessage.requestId !== 'undefined') {
    if (skMessage.state === 'COMPLETED') {
      if (skMessage.statusCode === 403) {
        alert('[ Status = ' + skMessage.statusCode + ' ]' + 'You must be authenticated to send commands');
      }
    }
  }
  // console.log(event)
  if (typeof skMessage.updates === 'object' && skMessage.hasOwnProperty('updates')) {
    decodeSwDeltas(skMessage);
  }
}

function skSocketKeepAlive() {
  if (skSocketIsconnected === true) {
    if (skSocketlastMessage < Date.now() - skSocketKeepaliveIntervalMs) {
      skSocket.send("{}");
      //console.log("Sending keep alive")
    }
    setTimeout(skSocketKeepAlive, skSocketKeepaliveIntervalMs);
  }
}