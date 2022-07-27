/**
 * Created by ryeubi on 2015-08-31.
 * Updated 2017.03.06
 * Made compatible with Thyme v1.7.2
 */

var net = require('net');
var util = require('util');
var fs = require('fs');
var xml2js = require('xml2js');


var wdt = require('./wdt');
var rgbLib = require('bbb-tcs34725');
var rgb = null;


var useparentport = '';
var useparenthostname = '';

var upload_arr = [];
var download_arr = [];

var conf = {};

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

                        for (j = 0; j < download_arr.length; j++) {
                            if (download_arr[j].ctname == sink_obj.ctname) {
                                g_down_buf = JSON.stringify({id: download_arr[i].id, con: sink_obj.con});
                                console.log(g_down_buf + ' <----');
                                myPort.write(g_down_buf);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}

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
            tas_state = 'init_i2c';
        }
    }
    else if(tas_state == 'init_i2c') {
        rgb = rgbLib.use({
            "bus"     : "/dev/i2c-1", 
            "module_id" : 0x44
        })
        rgb.on('ready',function(){
            console.log('tas init i2c ok');
            tas_state='connect';
        })
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
    else if (tas_state=='upload') {
        saveLastestData();
        //rgb.on('ready',saveLastestData);
    }
}


//wdt.set_wdt(require('shortid').generate(), 2, timer_upload_action);
wdt.set_wdt(require('shortid').generate(), 3, tas_watchdog);

var cur_c = '';
var pre_c = '';
var g_sink_buf = '';
var g_sink_ready = [];
var g_sink_buf_start = 0;
var g_sink_buf_index = 0;
var g_down_buf = '';

function showPortOpen() {
    console.log('port open. Data rate: ' + myPort.options.baudRate);
}



var r,g,b,c,cct,illu;
function saveLastestData() {

    rgb.getRawData(function(err,colors){ // r,g,b,c
        if (err) throw err;
      
        r=colors.red;
        g=colors.green;
        b=colors.blue;
        c=colors.clear;
        console.log(r+" "+g+" "+b+" "+c+" "); 
     })
     
    rgb.calculateColorTemperature(function(err, temp) { // cct
        if (err) throw err;
        cct=Math.floor(temp);
    })
    
    rgb.calculateLux(function(err, lux) { // lux
      if (err) throw err;
      illu=Math.floor(lux);
      
      console.log('sensor value : '+"r/"+r+",g/"+g+",b/"+b+",c/"+c+",cct/"+cct+",lux/"+illu);
      create_send_packet(r,g,b,c,cct,illu);
    })
    
  
}

var send_packet='';

function create_send_packet(r,g,b,c,cct,illu)
{
    send_packet="r/"+r+",g/"+g+",b/"+b+",c/"+c+",cct/"+cct+",lux/"+illu;
    console.log('send_packet : '+send_packet);
    upload_action(send_packet);
}

function upload_action(data)
{
    if (tas_state == 'upload') {
        var con = {value: 'TAS' + data};
            var cin = {ctname: 'cnt-rgb', con: data};
            console.log(JSON.stringify(cin) + ' ---->');
            upload_client.write(JSON.stringify(cin) + '<EOF>');
    }
}


function showPortClose() {
    console.log('port closed.');
}

function showError(error) {
    var error_str = util.format("%s", error);
    console.log(error.message);
    if (error_str.substring(0, 14) == "Error: Opening") {

    }
    else {
        console.log('SerialPort port error : ' + error);
    }
}

