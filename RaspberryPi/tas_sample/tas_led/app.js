/**
 * Created by ryeubi on 2015-08-31.
 * Updated 2017.03.06
 * Made compatible with Thyme v1.7.2
 */

var net = require('net');
var util = require('util');
var fs = require('fs');
var xml2js = require('xml2js');
var exec = require("child_process").exec;

var wdt = require('./wdt');

var useparentport = '';
var useparenthostname = '';

var upload_arr = [];
var download_arr = [];

var test_device = '';
var test_service='';
var test_characteristic='';

var characteristic1 = '';
var conf = {};

require('dotenv').config();
const { createBluetooth } = require('node-ble');

// This is an async file read
fs.readFile('conf.xml', 'utf-8', function (err, data) {
    if (err) {
        console.log("FATAL An error occurred trying to read in the file: " + err);
        console.log("error : set to default for configuration")
    }
    else {
        var parser = new xml2js.Parser({explicitArray: false});
        parser.parseString(data, function (err, result) {
            if (err) {
                console.log("Parsing An error occurred trying to read in the file: " + err);
                console.log("error : set to default for configuration")
            }
            else {
                var jsonString = JSON.stringify(result);
                conf = JSON.parse(jsonString)['m2m:conf'];

                useparenthostname = conf.tas.parenthostname;
                useparentport = conf.tas.parentport;

                // BLE 변수 설정
                test_device = conf.ble.test_device;
                test_service = conf.ble.test_service;
                test_characteristic = conf.ble.test_characteristic;

                if(conf.upload != null) {
                    if (conf.upload['ctname'] != null) {
                        upload_arr[0] = conf.upload;
                    }
                    else {
                        upload_arr = conf.upload;
                    }
                }

                if(conf.download != null) {
                    if (conf.download['ctname'] != null) {
                        download_arr[0] = conf.download;
                    }
                    else {
                        download_arr = conf.download;
                    }
                }
            }
        });
    }
});


var tas_state = 'init';

var upload_client = null;

var t_count = 0;

var tas_download_count = 0;

function on_receive(data) {
    if (tas_state == 'connect' || tas_state == 'reconnect' || tas_state == 'upload') {
        var data_arr = data.toString().split('<EOF>');
        if(data_arr.length >= 2) {
            for (var i = 0; i < data_arr.length - 1; i++) {
                var line = data_arr[i];
                var sink_str = util.format('%s', line.toString());
                var sink_obj = JSON.parse(sink_str);

                if (sink_obj.ctname == null || sink_obj.con == null) {
                    console.log('Received: data format mismatch');
                }
                else {
                    if (sink_obj.con == 'hello') {
                        console.log('Received: ' + line);

                         if (++tas_download_count >= download_arr.length) {
                            tas_state = 'upload';
                         }
                    }
                    else {
                        for (var j = 0; j < upload_arr.length; j++) {
                            if (upload_arr[j].ctname == sink_obj.ctname) {
                                console.log('ACK : ' + line + ' <----');
                                break;
                            }
                        }
                        /* Mobius-> &Cube -> Tas로 받아온 데이터 */
                        for (j = 0; j < download_arr.length; j++) {
                            if (download_arr[j].ctname == sink_obj.ctname) {
                                g_down_buf = JSON.stringify({id: download_arr[i].id, con: sink_obj.con});
                                console.log(g_down_buf + ' <----');
                                console.log("con print : "+sink_obj.con);
                                control_led(sink_obj.con); // LED 제어
                                console.log('LED 제어 완료');
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}


var Serial = null;
var myPort = null;
function tas_watchdog() {
    if(tas_state == 'init') {
        upload_client = new net.Socket();

        upload_client.on('data', on_receive);

        upload_client.on('error', function(err) {
            console.log(err);
            tas_state = 'reconnect';
        });

        upload_client.on('close', function() {
            console.log('Connection closed');
            upload_client.destroy();
            tas_state = 'reconnect';
        });

        if(upload_client) {
            console.log('tas init ok');
            tas_state = 'init_ble';
        }
    }
    else if(tas_state == 'init_ble') {
        ble_connect();
        tas_state = 'connect';
    }
    else if(tas_state == 'connect' || tas_state == 'reconnect') {
        upload_client.connect(useparentport, useparenthostname, function() {
            console.log('upload Connected');
            tas_download_count = 0;
            for (var i = 0; i < download_arr.length; i++) {
                console.log('download Connected - ' + download_arr[i].ctname + ' hello');
                var cin = {ctname: download_arr[i].ctname, con: 'hello'};
                upload_client.write(JSON.stringify(cin) + '<EOF>');
            }

             if (tas_download_count >= download_arr.length) {
                 tas_state = 'upload';
             }
        });
    }
}

wdt.set_wdt(require('shortid').generate(), 3, tas_watchdog);

async function ble_connect(){ // BLE 연결
    const { bluetooth, destroy } = createBluetooth();

    // get bluetooth adapter
    const adapter = await bluetooth.defaultAdapter();
    await adapter.startDiscovery();
    console.log('BLE>> discovering');

    // get device and connect
    const device = await adapter.waitDevice(test_device);
    console.log('got device', await device.getAddress(), await device.getName());
    await device.connect(); // 기기 연결
    console.log('BLE>> connected');

    const gattServer = await device.gatt();

    // read write characteristic
    const service1 = await gattServer.getPrimaryService(test_service) // 서비스 설정
    characteristic1 = await service1.getCharacteristic(test_characteristic) // 캐릭터 설정
    console.log('BLE>> set characteristic ok')
}

function control_led(setData){ // led 제어
    characteristic1.writeValue(Buffer.from(hexStringToByteArray(setData)));
    console.log('BLE>> set LED : '+setData);
}

function hexStringToByteArray(hexString) {
    if (hexString.length % 2 !== 0) {
        throw "BLE>> Must have an even number of hex digits to convert to bytes";
    }
    var numBytes = hexString.length / 2;
    var byteArray = new Uint8Array(numBytes);
    for (var i=0; i<numBytes; i++) {
        byteArray[i] = parseInt(hexString.substr(i*2, 2), 16);
    }
    return byteArray;
  }
  
var cur_c = '';
var pre_c = '';
var g_sink_buf = '';
var g_sink_ready = [];
var g_sink_buf_start = 0;
var g_sink_buf_index = 0;
var g_down_buf = '';

