/*
 * Copyright 2022 Paul Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const path = require('path')
const fs = require('fs')

const put_path_skSwitchesWebApp = "electrical.switches.SkSwitches";
const put_path_SensESP = "electrical.switches.SenESP";
const numberOfSwitches = 8;
const SUCCESS_RES = { state: "COMPLETED", result: 200 };
const FAILURE_RES = { state: "COMPLETED", result: 400 };
const version = '1.0.0'



module.exports = function (app) {
  var plugin = {}
  var skSwitchSensESPState = 0
  var skOptions
  var EspClientOnline = false
  var SwitchNames = []
  plugin.id = "skswitches"
  plugin.name = "Switch Bank Controller"
  plugin.description = "Czone like Switches"

  function createChannelSchema(schema) {
    let channels = {
      type: "object",
      title: "Switch Channels",
      properties: {},
    };

    for (let i = 1; i <= numberOfSwitches; i++) {
      let channel = {
        type: "object",
        title: "Channel " + i,
        required: ["label"],
        properties: {
          label: {
            type: "string",
            title: "Name of Channel",
            description: "",
            default: i.toString(),
          },
        },
      };
      channels.properties[i] = channel;
    }

    schema.properties["channels"] = channels;
    return schema;
  }

  plugin.schema = function () {
    var schema = {
      type: "object",
      properties: {
        panelName: {
          type: "string",
          title: "Label for switch panel",
          default: "Switch Panel Label",
        },
        instance: {
          type: "number",
          title: "Instance of load controller",
          default: 0,
        },
        type: {
          type: "string",
          title: "Load controller Type",
          enum: ["NMEA2000", "SensESP"],
          enumNames: ["NMEA2000 Load controller", "SensESP relay board"],
          default: "NMEA2000",
        },
      },
    };
    createChannelSchema(schema);
    return schema;
  };

  plugin.start = function (options, restartPlugin) {
    // "put" path for switch change messages from the webApp
    skOptions = options;
    app.registerPutHandler(
      "vessels.self",
      put_path_skSwitchesWebApp,
      swChangeRequest
    )
    // "put" path for SensEsp "current state" messages
    app.registerPutHandler(
      "vessels.self",
      put_path_SensESP,
      SwitchesEspPutHandler
    )
    // save "options" json in applicaton/global memory to be read by SensEsp and the webapp
    saveOptionsToServer(skOptions)
    getSwitchNames(skOptions)
    app.debug("Plugin started");

  };

  // save options json to public access memory. Non Admin users can on "http get" from  the
  // 'applicationData' director.

  function saveOptionsToServer(options) {
    let location = path.join(
      app.config.configPath,
      'applicationData', 'global', plugin.id)
    try {
      if (!fs.existsSync(location)) {
        fs.mkdirSync(location)
      }
    }
    catch (err) {
      app.debug(err);
      return
    }
    let filepath = path.join(location, `${version}.json`)
    fs.writeFile(filepath, JSON.stringify(options, null, 2), function (err) {
      if (err) throw app.debug(err);
      app.debug('Application data saved!');
    });
  }

  plugin.stop = function () {

  }

  // SensEsp device send "current relay state" every 5 seconds, 
  // this is decoded and sent to the server as a 8 switch deltas

  function SwitchesEspPutHandler(context, path, value, callback) {
    app.debug('Switch  state is %d', value)
    if (!(value >= 0 && value < 256)) {
      return { message: `Invalid state: ${value}`, ...FAILURE_RES };
    } else {
      EspClientOnline = true
      currentState = value
      for (var switchIndex = 0; switchIndex < numberOfSwitches; switchIndex++) {
        var mask = currentState & (0x01 << switchIndex);
        value = mask == 0 ? 0 : 1;
        sendNamedDelta(switchIndex, value);
      }
      skSwitchSensESPState = currentState;
      return SUCCESS_RES;
    }

  }

  // Form the "named" i.e. "TriLight" delta and send to sk server

  function sendNamedDelta(switchNumber, value) {
    let switchName = SwitchNames[switchNumber]
    let delta = {
      updates: [
        {
          values: [
            {
              path: `electrical.switches.${switchName}.state`,
              value: value,
            },
          ],
        },
      ],
    };
    app.handleMessage(plugin.id, delta);
  }

  // Form the switch control delta and send to sk server

  function sendDelta(instance, indicator, value) {
    let delta = {
      updates: [
        {
          values: [
            {
              path: `electrical.switches.bank.${instance}.${indicator}.state`,
              value: value,
            },
          ],
        },
      ],
    };
    app.handleMessage(plugin.id, delta);
  }

  // Process a switch change from the webapp

  function swChangeRequest(context, path, value, callback) {
   
    if (skOptions.type == "NMEA2000") {
      if (sendN2kChange(value)) return SUCCESS_RES;
      else return { message: "Problem sending N2K", ...FAILURE_RES };
    }

    if (skOptions.type === "SensESP" && EspClientOnline === true) {
      updateSwitchState(value);
      return SUCCESS_RES;
         }
  }

  // A webapp switch has changed state, send a N2K change request message to the bus

  function sendN2kChange(valueJson) {
    dst = 255; //broadcast to all devices
    const pgn = {
      pgn: 127502,
      dst: dst,
      "Switch Bank Instance": valueJson.swInstance,
    };
    pgn[`Switch${valueJson.swSwitch}`] = valueJson.State === 1 ? "On" : "Off";
    app.debug("N2K sending %j", pgn);
    app.emit("nmea2000JsonOut", pgn);
    return true;
  }

  // A webapp switch has changed state, send a update delta and maintain current switch bank state 

  function updateSwitchState(valueJson) {
    if (skOptions.type == "NMEA2000") {
      sendDelta(valueJson.swInstance, valueJson.swSwitch, valueJson.State)
    } else sendNamedDelta(valueJson.swSwitch - 1, valueJson.State)

    var mask = 0x01;
    mask = mask << (valueJson.swSwitch - 1);
    if (valueJson.State === 1) skSwitchSensESPState |= mask;
    else skSwitchSensESPState &= ~mask;
    app.debug('Switch  state is %d', skSwitchSensESPState)
  }

  // get the switch labels for building named deltas, store in SwitchNames[] 

  function getSwitchNames(options) {
    app.debug('parsing plugin data')
    var pluginDatachannels = options["channels"]

    for (var index = 0; index < numberOfSwitches; index++) {
      SwitchNames[index] = pluginDatachannels[(index + 1).toString()]["label"]
      app.debug('Switch name is %s', SwitchNames[index])
    }

  }
  return plugin;

};
