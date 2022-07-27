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
var { SerialPort } = require('serialport');
var { ReadlineParser } = require('@serialport/parser-readline')

var usecomport = '';
var usebaudrate = '';
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

                usecomport = conf.tas.comport;
                usebaudrate = conf.tas.baudrate;
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
                                //myPort.write(g_down_buf);
                                setLedFan(sink_obj.con);
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}

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
            tas_state = 'init_serial';
        }
    }
    else if(tas_state == 'init_serial') {
        //   SerialPort.list().then(ports => {
        //       ports.forEach(function(port){
        //           console.log("열린 포트 : "+port.path);
        //       });
        //   });

        myPort = new SerialPort({
            path : usecomport, 
            baudRate : parseInt(usebaudrate, 10),
            buffersize : 1
        });
        console.log(usecomport+" 시리얼 포트 연결 완료");

        var parser = new ReadlineParser();
        //myPort.pipe(parser);
        myPort.on('open', showPortOpen);
        //parser.on('data', saveLastestData);
        myPort.on('data', saveLastestData);
        myPort.on('close', showPortClose);
        myPort.on('error', showError);
        
        if(myPort) {
            console.log('tas init serial ok');
            tas_state = 'connect';
        }
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

//wdt.set_wdt(require('shortid').generate(), 2, timer_upload_action);
wdt.set_wdt(require('shortid').generate(), 3, tas_watchdog);
wdt.set_wdt(require('shortid').generate(), 59, requestSensorValue); // 센서 상태 체크
wdt.set_wdt(require('shortid').generate(), 2, requestLedFanState); // LED, FAN 상태 체크
//wdt.set_wdt(require('shortid').generate(), 15, setTime); // LED, FAN 상태 체크



var cur_c = '';
var pre_c = '';
var g_sink_buf = '';
var g_sink_ready = [];
var g_sink_buf_start = 0;
var g_sink_buf_index = 0;
var g_down_buf = '';

function showPortOpen() {
    console.log('port open.');
}

function requestSensorValue() {
    if(tas_state == 'upload'){
        var packet_hex= "0202ff53ff00ffffffffffffffffffffffffffffffffffffffffffffff03"; // 상태 체크 패킷
        var packet_bytes = hexToBytes(packet_hex); // 16진수 -> Bytes
        myPort.write(packet_bytes); // 시리얼 포트로 전송
        console.log("센서 상태 체크 패킷 전송 >> "+packet_hex)
    }
}

function requestLedFanState() {
    if(tas_state == 'upload' ){
        var packet_hex= "0201ff73ff00ffffffffffffffffffffffffffffffffffffffffffffff03"; // 상태 체크 패킷
        var packet_bytes = hexToBytes(packet_hex); // 16진수 -> Bytes
        myPort.write(packet_bytes); // 시리얼 포트로 전송
        console.log("LED, FAN 상태 체크 패킷 전송 >> "+packet_hex);
    }
}

function requestLedFanPowerState(){
    if(tas_state == 'upload'){
         var packet_hex = "0201ff53ff00ffffffffffffffffffffffffffffffffffffffffffffff03" // 전원 상태 체크 패킷
        var packet_bytes = hexToBytes(packet_hex);
        myPort.write(packet_bytes); // 시리얼 포트로 전송
        console.log("LED, FAN 전원 상태 체크 패킷 전송 >> "+packet_hex);

    }
}

function requestLedFanOnOffTime(){
    if(tas_state == 'upload'){
        var packet_hex = "0201ff52ff00ffffffffffffffffffffffffffffffffffffffffffffff03" // 전원 상태 체크 패킷
       var packet_bytes = hexToBytes(packet_hex);
       myPort.write(packet_bytes); // 시리얼 포트로 전송
       console.log("LED, FAN On/Off time 체크 패킷 전송 >> "+packet_hex);

   }
}
function setTime(){
    if(tas_state == 'upload' ){
        var packet_hex= "0202ff54ff00ff3470ffffffffffffffffffffffffffffffffffffffff03"; // 시간 설정 패킷
        var packet_bytes = hexToBytes(packet_hex); // 16진수 -> Bytes
        myPort.write(packet_bytes); // 시리얼 포트로 전송
        console.log("시간 설정 패킷 전송 >> "+packet_hex);
    }
}

function setLedFan(data){ 
    // data : led종류(1: red, 2: blue, 3: fan)/제어종류(on/off: 1, 세기 조절: 2, 시간 설정: 3)/제어값(on: 1, off: 2, 세기: 1~9, 시간: hh:mm,hh:mm)
    
    var split = data.split("/");
    var channel=""; // 채널
    var command=""; // 제어 명령(on/off인지, pwm/duty인지)
    var index=""; // 제어 수치
    var packet="";
    var packet_bytes;

    channel = split[0]; // 채널 설정 

    if(split[1] == "1"){ // 제어 명령이 on/off일 때
        command = "4C"
        if(split[2] == "1"){
            index = "01ffffffffff"    // on
        } 
        else index = "00ffffffffff" // off
    }
    else if(split[1] == "2"){ // 제어 명령이 세기 조절일 때
        command = "50";
        var pwm = "000064"; // 16진수 64 = 10진수 100
        var duty = "0000"+(parseInt(split[2])*10).toString(16).padStart(2,'0');
        index = pwm + duty;
    }

    packet ="0201ff"+command+"ff0"+channel+"ff"+index+"ffffffffffffffffffffffffffffffff03";
    packet_bytes = hexToBytes(packet);
    myPort.write(packet_bytes);
    console.log("LED/FAN 제어 >> "+packet);
}



function hexToBytes(packet_hex){ // 16진수 -> Bytes
    for (var bytes = [], c = 0; c < packet_hex.length; c += 2)
        bytes.push(parseInt(packet_hex.substr(c, 2), 16));
    return bytes;
}


function saveLastestData(data) {
    console.log("아일랜드 데이터 받음");
    var buffer = Buffer.alloc(50);
    var hex = '';
    var data_str = '';
 
    for(var i = 0; i < buffer.length; i++){
        buffer[i] = data[i];
        hex = buffer[i].toString(16).padStart(2,'0');
        data_str += hex;
    }
    console.log("Received Data >> " + data_str);
    parsePacket(data_str);
}

 var send_packet = "";

function parsePacket(data){
    var packet_parsed = data.substring(20, 80);
    console.log("Parsed Packet >> " + packet_parsed);

    var key=packet_parsed.substring(0,8);
    if(key == "0202ff53"){ // 센서 상태 체크
        var time = packet_parsed.substring(14,16)+":"+packet_parsed.substring(16,18);
        var temp = packet_parsed.substring(21, 22) + packet_parsed.substring(23, 24) + "." + packet_parsed.substring(25, 26);
        var humi = packet_parsed.substring(29, 30) + packet_parsed.substring(31, 32) + "." + packet_parsed.substring(33, 34);
        var co2 = packet_parsed.substring(39, 40) + packet_parsed.substring(41, 42) + packet_parsed.substring(42, 43);
        var illum = packet_parsed.substring(49, 50) + packet_parsed.substring(51, 52) + packet_parsed.substring(53, 54);
        var gas = packet_parsed.substring(56, 58);
        
        send_packet = "time/"+time+",temp/"+temp+",humi/"+humi+",co2/"+co2+",illum/"+ illum+ ",gas/"+gas;
        console.log("Sensor State >> "+send_packet);
        upload_action(key, send_packet); // upload
                
    } else if(key == "0201ff73"){ // led, fan 상태 체크
        var red = parseInt(packet_parsed.substring(10,12), 16);
        var blue = parseInt(packet_parsed.substring(24,26), 16);
        var fan = parseInt(packet_parsed.substring(38,40), 16);
        
        send_packet = "red/"+red+",blue/"+blue+",fan/"+fan;
        console.log("LED/FAN State >> "+send_packet);

       requestLedFanPowerState();
        
    } else if(key == "0201ff53"){ // led, fan 전원 상태 체크
        var power_ch1 = parseInt(packet_parsed.substring(16,18),16);
        var power_ch2 = parseInt(packet_parsed.substring(18,20),16);
        var power_ch3 = parseInt(packet_parsed.substring(20,22),16);
        send_packet += ",power_ch1/"+power_ch1+",power_ch2/"+power_ch2+",power_ch3/"+power_ch3;
        console.log("전원 상태 추가한 패킷 >> "+send_packet);

        requestLedFanOnOffTime();
        
    } else if(key == "0201ff52"){
        var start_time_ch1 = packet_parsed.substring(10,12)+":"+packet_parsed.substring(12,14);
        var finish_time_ch1 = packet_parsed.substring(14,16)+":"+packet_parsed.substring(16,18);
        var start_time_ch2 = packet_parsed.substring(20,22)+":"+packet_parsed.substring(22,24);
        var finish_time_ch2 = packet_parsed.substring(24,26)+":"+packet_parsed.substring(26,28);
        var start_time_ch3 = packet_parsed.substring(30,32)+":"+packet_parsed.substring(32,34);
        var finish_time_ch3 = packet_parsed.substring(34,36)+":"+packet_parsed.substring(36,38);
        send_packet += ",start_time_ch1/" + start_time_ch1 + ",finish_time_ch1/" +finish_time_ch1 + ",start_time_ch2/" + start_time_ch2 + ",finish_time_ch2/" + 
                        finish_time_ch2 + ",start_time_ch3/" + start_time_ch3+",finish_time_ch3/"+finish_time_ch3;
        console.log("On/Off time 추가한 패킷 >> "+send_packet);
        upload_action(key, send_packet); // upload
    }
}


function upload_action(key, data)
{
    if (tas_state == 'upload') {
        var con = {value: 'TAS' + data};
        if(key == "0202ff53"){
            var cin = {ctname: 'cnt-sensor', con: data};
            console.log(JSON.stringify(cin) + ' ---->');
            upload_client.write(JSON.stringify(cin) + '<EOF>');
        }
        else if(key =="0201ff52"){
            var cin = {ctname: 'cnt-ledfan', con: data};
            console.log(JSON.stringify(cin) + ' ---->');
            upload_client.write(JSON.stringify(cin) + '<EOF>');
        }
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

