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

import Client, { Discovery } from '@signalk/client'

const pluginDataSwLabels = []
const pluginDataId = 'skswitches'
const pluginDataPath = '/plugins'
const indicatorColourOn = "#00a651"
const indicatorColourOff = "0c1927"
const sw501TimedOut = 1
const noMsgTimedOut = 2


var numberOfSwitches = 8
var offLine = false
var pluginDataInstance = 0
var pluginDataEnabled = false
var pluginDataReady = false
var handle501Timeout = null;
var handleNoMsgTimeout = null;
var sw501TimeoutTime = 1000;
var noMsgTimeoutTime = 15000;
var currentSwitchState = 0x00;
var swBankInstance = 100
var pluginDataPanelName = ''
//var pluginDataLCtype = ''

let client = null

client = new Client({
  hostname: location.hostname,
  port: location.port,
  useTLS: false,
  rejectUnauthorized: false,
  useAuthentication: true,
  notifications: false,
  reconnect: true,
  autoConnect: true,
  username: 'webapp',
  password: 'fedcba9876',
  deltaStreamBehaviour: 'self',
})

/*
 ** It all starts here
 */

window.onload = function () {
  getpluginData()
  setSwitchClickEventListeners()
  setAllSwitchesEnabled(true)
  setAllToCurrentState()
  handleNoMsgTimeout = setTimeout(updateTimeOutTimer, noMsgTimeoutTime, noMsgTimedOut);
  window.onbeforeunload = function (event) {
    client.unsubscribe()
    client.disconnect()
  }
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
  sendSwChange(swBankInstance, switchNumber, swState)
}

/*
 ** send a switch change command
 */

const swCmdMsg = {
  "path": "electrical.switches.bank",
  "value": {
    "swInstance": 0,
    "swSwitch": 0,
    "State": 0,
  }
}

/*
 ** a switch has changed state, send out to the "end point" i.e the HW
 */

var sendSwChange = function (swInstance, swNumber, swState) {

  swCmdMsg.value.swSwitch = swNumber
  swCmdMsg.value.State = swState
  swCmdMsg.value.swInstance = swInstance
  // swCmdMsg.value.LCtype = pluginDataLCtype
  var cmdJson = '{"context":"vessels.self","requestId":"184743-434373-348483","put":' + JSON.stringify(swCmdMsg) + '}'
  handle501Timeout = setTimeout(updateTimeOutTimer, sw501TimeoutTime, sw501TimedOut);
  setIndicatorText(swNumber, "Pending")
  client.connection.send(cmdJson)
}

/*
 ** listen for a switch delta
 */

client.on('delta', (json) => decodeSwMessages(json))

/*
 ** a switch delta has arrived to process
 */

var decodeSwMessages = function (json) {
  if (typeof json.updates === 'object') {
    for (var key in json) {
      if (key == "updates") {
        var values = json[key][0]['values'];
        for (var tuple in values) {
          var path = values[tuple]['path']
          path.indexOf("locate")
          var SwitchInstance = parseInt(path.split(".")[3])
          var SwitchId = parseInt(path.split(".")[4]) // get switch number and convert to an integer
          var value = values[tuple]['value']
        }
        if (SwitchInstance == swBankInstance) {
          if (offLine == true) {
            offLine = false
            setAllSwitchesEnabled(true)
            setAllToCurrentState()
          }
          setSwByIndexAndState(SwitchId - 1, value);
          clearTimeout(handle501Timeout)
          clearTimeout(handleNoMsgTimeout)
          handleNoMsgTimeout = setTimeout(updateTimeOutTimer, noMsgTimeoutTime, noMsgTimedOut);
        }
      }
    }
  }
}
if (typeof json === 'object' && json.hasOwnProperty('alert')) {
  //console.log('alert :', json);
}

var updateTimeOutTimer = (state) => {
  if (state == sw501TimedOut) {
    client.connection.reconnect()
  } else if (state == noMsgTimedOut) {
    resetAllSwitches
    setAllSwitchesEnabled(false)
    offLine = true
  }
}

/*
 ** get config data from the SK server
 */

function getpluginData() {
  //console.log('getting plugin data')
  client
    .API()
    .then((api) => api.get(pluginDataPath))
    .then((pluginsData) => {
      return (parsePluginData(pluginsData))
    })
    .catch((err) => {
      // 404 means successful request, but the data isn't present on the vessel
      if (err.message.includes('404')) {
        return false
      }
    })

}

/*
 ** parse the plugin data config data from the SK server
 */

function parsePluginData(pluginsData) {
  console.log('parsing plugin data')
  if (typeof pluginsData === 'object') {
    pluginsData.forEach((pluginData) => {
      if (pluginData["id"] == pluginDataId) {
        pluginDataEnabled = pluginData["data"]["enabled"]
        if (pluginDataEnabled !== true) {
          alert("Plugin " + pluginDataId + " not enabled, enable plugin in server")
          return false;
        }
        pluginDataReady = true
        var configuration = pluginData["data"]["configuration"]
        pluginDataInstance = configuration["instance"]
        pluginDataPanelName = configuration["panelName"]
        var pluginDatachannels = configuration["channels"]
        // pluginDataLCtype = configuration["type"]
        // console.log(pluginDataLCtype)
        for (var index = 0; index < numberOfSwitches; index++) {
          pluginDataSwLabels[index] = pluginDatachannels[(index + 1).toString()]["label"]
        }
        pluginDataSwLabels.forEach((label, index) => {
          document.getElementById("label" + (index + 1).toString()).innerHTML = label
        })
        document.getElementById("vesselName").innerHTML = pluginDataPanelName
        swBankInstance = pluginDataInstance
        client.subscribe([
          {
            context: 'vessels.*',
            subscribe: [
              {
                path: 'electrical.switches.bank.' + swBankInstance.toString() + '.*.state',
                policy: 'instant',
              },
            ],
          },
        ])
      }
    })
  }
  return true
}
