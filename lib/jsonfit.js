/******
 * jsonfit
 * Author: Mikael Lofjärd
 * License: MIT
 ******/

/* global define */

(function (root, factory) {
  if (typeof exports === "object" && exports) {
    factory(exports); // CommonJS
  } else {
    var jsonfit = {};
    factory(jsonfit);
    if (typeof define === "function" && define.amd) {
      define(jsonfit); // AMD
    } else {
      root.jsonfit = jsonfit; // <script>
    }
  }
}(this, function (jsonfit) {

  const scConst = (180/Math.pow(2,31)); // Used for converting to Long/Lat coordinates

  /* Private methods */

  function addEndian(littleEndian, bytes) {
    let result = 0;
    if (!littleEndian) bytes.reverse();
    for(let i = 0; i < bytes.length; i++) {
      result += (bytes[i] << (i << 3)) >>> 0;
    }
    return result;
  }

  /*
   * blob: Binary FIT file as UInt8Array
   */
  function calculateCRC(blob, start, end) {
    const crc_table = [
      0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
      0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400
    ];

    console.log('crcing byte ' + start + ' to ' + end);

    let crc = 0;
    for (let i = start; i < end; i++) {
      var byte = blob[i];
      var tmp = crc_table[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF;
      crc = crc ^ tmp ^ crc_table[byte & 0xF];
      tmp = crc_table[crc & 0xF];
      crc = (crc >> 4) & 0x0FFF;
      crc = crc ^ tmp ^ crc_table[(byte >> 4) & 0xF];
    }

    return crc;
  }

  /*
   * blob: Binary FIT file as UInt8Array
   */
  function readData(blob, fDef, startIndex) {
    if (fDef.endianAbility === true) {
      let temp = [];
      for (let i = 0; i < fDef.size; i++) {
        temp.push(blob[startIndex + i]);
      }
      let uint32Rep = addEndian(fDef.littleEndian, temp);

      if (fDef.dataType == 'sint32') {
        return (uint32Rep >> 0);
      }

      return uint32Rep;
    }
    return blob[startIndex];
  }

  function readRecord(blob, messageTypes, startIndex) {
    const logMessageNo = 9999;
    let recordHeader = blob[startIndex];
    let localMessageType = (recordHeader & 15);
    //console.log('Local Msg type: ' + localMessageType);
    if ((recordHeader & 64) == 64) {
      // is definition message
      // startIndex + 1 is reserved

      let lEnd = blob[startIndex + 2] === 0;
      let mTypeDef = {
        littleEndian: lEnd,
        globalMessageNumber: addEndian(lEnd, [blob[startIndex+3], blob[startIndex+4]]),
        numberOfFields: blob[startIndex + 5],
        fieldDefs: []
      };

      if (mTypeDef.globalMessageNumber == logMessageNo) {
        console.log('Found definition message');
        console.log('GlobalMessageNumber: ' + mTypeDef.globalMessageNumber);
        console.log('# fields: ' + mTypeDef.numberOfFields);
      }

      let message = fitMessage(mTypeDef.globalMessageNumber);
      // loop over field definitions
      for (let i = 0; i < mTypeDef.numberOfFields; i++) {
        let fDefIndex = startIndex + 6 + (i * 3);
        let baseType = blob[fDefIndex + 2];
        let fDef = {
          fDefNo: blob[fDefIndex],
          size: blob[fDefIndex + 1],
          endianAbility: (baseType & 128) == 128,
          littleEndian: lEnd,
          baseTypeNo: (baseType & 15),
          name:  message.fieldName(blob[fDefIndex]),
          type: message.type(blob[fDefIndex]),
          dataType: fitMessageBaseType(baseType & 15)
        };

      //  if (mTypeDef.globalMessageNumber == logMessageNo) {
      //    console.log('--');
      //    console.log('  FDefNo: ' + fDef.fDefNo);
      //    console.log('  Name: ' + fDef.name);
      //    console.log('  Size: ' + fDef.size);
      //    console.log('  Base type: ' + baseType);
      //    console.log('  Endian ability: ' + fDef.endianAbility);
      //    console.log('  BT number: ' + fDef.baseTypeNo);
      //    console.log('  Data type: ' + fDef.dataType);
      //  }
        mTypeDef.fieldDefs.push(fDef);
      }

      messageTypes[localMessageType] = mTypeDef;

      return {
        messageType: 'fieldDescription',
        nextIndex: startIndex + 6 + (mTypeDef.numberOfFields * 3)
      };
    } else {
      // is data message
      let messageType = messageTypes[localMessageType];
      // console.log('Found data message - ' + fitMessage(messageType.globalMessageNumber).name);
      if ((recordHeader & 128) == 128) {
        // compressed header
        alert('Compressed');
        return {
          messageType: 'compressed',
          nextIndex: 99999999999999999999999999999
        };
      } else {
        // uncompressed header
        let messageSize = 0;
        let readDataFromIndex = startIndex + 1;
        if (messageType.globalMessageNumber == logMessageNo) {
            console.log('--');
        }

        let fields = {};
        let message = fitMessage(messageType.globalMessageNumber);

        for (let i = 0; i < messageType.fieldDefs.length; i++) {
          let fDef = messageType.fieldDefs[i];
          let data = readData(blob, fDef, readDataFromIndex);
          if (fDef.type == 'position') data *= scConst;
          if (fDef.type == 'time') data = new Date((data * 1000) + 631062000000);
            

          console.log(message.name + ' - ' + message.fieldName(fDef.fDefNo) + ': ' + data);
      

          let fieldName = message.fieldName(fDef.fDefNo);
          if (fieldName !== 'unknown') {
            fields[fieldName] = data;
          }
          readDataFromIndex += fDef.size;
          messageSize += fDef.size;
        }

        let result = {
          messageType: message.name,
          nextIndex: startIndex + messageSize + 1
        };
        
        // if record
        if (messageType.globalMessageNumber === FIT.MSGTYPE.RECORD) {
          result.point = [fields.positionLong, fields.positionLat];
        }
        // if lap
        if (messageType.globalMessageNumber === FIT.MSGTYPE.LAP) {
          result.point = [fields.startPositionLong, fields.startPositionLat];
        }
        // if session
        if (messageType.globalMessageNumber === FIT.MSGTYPE.SESSION) {
          result.metadata = {
            speed: fields.avgSpeed,
            distance: fields.totalDistance,
            time: fields.totalTimerTime,
            sport: fields.sport
          };
        }

        return result; 
      }

    }
  }
  /* Public methods */

  /*
   * blob: Binary FIT file as UInt8Array
   */
  jsonfit.parse = function(blob, cbSuccess, cbError) {

    // check if file is big enough to hold a FIT header
    if (blob.length < 12){
      cbError('File to small to be a FIT file');
      return;
    }

    // check for a correct header size (12 or 14 bytes)
    let headerLength = blob[0];
    if (headerLength != 14 && headerLength != 12) {
      cbError('Incorrect header size');
      return;
    }

    // check for '.FIT' string in header
    let fileTypeString = '';
    for(let i = 8; i < 11; i++) {
      fileTypeString += ' - ' + String.fromCharCode(blob[i]);
    }
    if (fileTypeString !== '.FIT'){
      cbError('Missing \'.FIT\' in header');
      return;
    }

    // check CRCs
    if (headerLength == 14) {
      let crcHeader = blob[12] + (blob[13] << 8);
      let crcHeaderCalc = calculateCRC(blob, 0, 12);
      if (crcHeader !== crcHeaderCalc) {
        cbError('Header CRC mismatch');
        return;
      }
    }
    let dataLength = blob[4] + (blob[5] << 8) + (blob[6] << 16) + (blob[7] << 24);
    let crcStart = dataLength + headerLength;
    let crcFile = blob[crcStart] + (blob[crcStart + 1] << 8);
    let crcFileCalc = calculateCRC(blob, headerLength === 12 ? 0 : headerLength, crcStart);
    
    if(crcFile !== crcFileCalc) {
      cbError('File CRC mismatch');
      return;
    }


    let fitAsJson = {};
    let sessions = [];
    let laps = [];
    let records = [];
    let events = [];

    let loopIndex = headerLength;
    let messageTypes = [];

    while (loopIndex < crcStart) {
      let {nextIndex, messageType, message} = readRecord(blob, messageTypes, loopIndex);
      loopIndex = nextIndex;

      if (messageType == 'record') {
        records.push(message);
      }
      else if (messageType == 'lap') {
        laps.push(message);
      }
      else if (messageType === 'session') {
        sessions.push(message);
      }
      else if (messageType === 'event') {
        events.push(message);
      }
    }

    fitAsJson.sessions = sessions;
    /* TODO: group by timestamp */
    fitAsJson.laps = laps;
    fitAsJson.records = records;
    fitAsJson.events = events;

    cbSuccess(fitAsJson);
  };

}));