        "content-security-policy": "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "cross-origin",
        "origin-agent-cluster": "?1",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=15552000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-dns-prefetch-control": "off",
        "x-download-options": "noopen",
        "x-frame-options": "SAMEORIGIN",
        "x-permitted-cross-domain-policies": "none",
        "x-xss-protection": "0",
        "vary": "Origin",
        "access-control-allow-credentials": "true",
        "ratelimit-policy": "1000;w=900",
        "ratelimit-limit": "1000",
        "ratelimit-remaining": "920",
        "ratelimit-reset": "254",
        "x-request-id": "ee9e9e37-30b5-417d-9c2c-0d0ebf8f66ee",
        "content-type": "application/json; charset=utf-8",
        "content-length": "1436",
        "etag": "W/\"59c-XbRK5GSC5V8sjUNPPlpo+iA99kg\"",
        "date": "Thu, 05 Mar 2026 10:56:34 GMT",
        "connection": "keep-alive",
        "keep-alive": "timeout=5"
      },
      "body": {
        "code": 500,
        "msg": "Failed to log media event",
        "data": {
          "stack": "Error: Failed to log media event\n    at Object.logMediaEvent (C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\src\\services\\analytics.service.js:325:11)\n    at C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\src\\routes\\analytics.routes.js:665:43\n    at C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\src\\middleware\\errorHandler.js:109:21\n    at Layer.handle [as handle_request] (C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\node_modules\\express\\lib\\router\\layer.js:95:5)\n    at next (C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\node_modules\\express\\lib\\router\\route.js:149:13)\n    at requireServiceKey (C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\src\\middleware\\auth.js:135:3)\n    at Layer.handle [as handle_request] (C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\node_modules\\express\\lib\\router\\layer.js:95:5)\n    at next (C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\node_modules\\express\\lib\\router\\route.js:149:13)\n    at Route.dispatch (C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\node_modules\\express\\lib\\router\\route.js:119:3)\n    at Layer.handle [as handle_request] (C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\node_modules\\express\\lib\\router\\layer.js:95:5)"
        }
      }
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

 FAIL  api/scenarios/analytics-flow.spec.js
  Analytics Flow E2E
    4.4 - Record game session                                                                  
      × should start a session (71 ms)                                                         
      × should record a game attempt (50 ms)                                                   
    5.8 - Record media playback                                                                
      × should record a media event (32 ms)                                                    
    10.1 - Query sessions                                                                      
      √ should return session list (108 ms)                                                    
    10.3 - Query usage stats                                                                   
      √ should return daily usage for a device (97 ms)                                         
    Dashboard summary                                                                          
      √ should return dashboard summary (108 ms)                                               
                                                                                               
  ● Analytics Flow E2E › 4.4 - Record game session › should start a session                    
                                                                                               
    assert.strictEqual(received, expected)

    Expected value to strictly be equal to:
      200
    Received:
      500

    Message:
      HTTP status 500 !== 200

    500 !== 200


      at Expect._validateStatus (node_modules/pactum/src/models/expect.js:106:14)
      at Expect.validate (node_modules/pactum/src/models/expect.js:47:10)
      at Tosser.validateResponse (node_modules/pactum/src/models/Tosser.js:255:23)
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:219:18)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:18)

  ● Analytics Flow E2E › 4.4 - Record game session › should record a game attempt

    assert.strictEqual(received, expected)

    Expected value to strictly be equal to:
      200
    Received:
      500

    Message:
      HTTP status 500 !== 200

    500 !== 200


      at Expect._validateStatus (node_modules/pactum/src/models/expect.js:106:14)
      at Expect.validate (node_modules/pactum/src/models/expect.js:47:10)
      at Tosser.validateResponse (node_modules/pactum/src/models/Tosser.js:255:23)
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:219:18)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:18)

  ● Analytics Flow E2E › 5.8 - Record media playback › should record a media event

    assert.strictEqual(received, expected)

    Expected value to strictly be equal to:
      200
    Received:
      500

    Message:
      HTTP status 500 !== 200

    500 !== 200


      at Expect._validateStatus (node_modules/pactum/src/models/expect.js:106:14)
      at Expect.validate (node_modules/pactum/src/models/expect.js:47:10)
      at Tosser.validateResponse (node_modules/pactum/src/models/Tosser.js:255:23)
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:219:18)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:18)

  console.warn
    Request

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {
      "url": "http://localhost:8002/toy/admin/rfid/series",
      "method": "POST",
      "headers": {
        "X-Service-Key": "da11d988-f105-4e71-b095-da62ada82189"
      },
      "path": "/toy/admin/rfid/series",
      "body": {
        "name": "e2e-test-series-aa1d3f0d",
        "startUid": "E2EAA1D000001",
        "endUid": "E2EAA1D000010"
      },
      "timeout": 15000
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    Response                                                                                   

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "statusCode": 400,
      "headers": {
        "content-security-policy": "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "cross-origin",
        "origin-agent-cluster": "?1",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=15552000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-dns-prefetch-control": "off",
        "x-download-options": "noopen",
        "x-frame-options": "SAMEORIGIN",
        "x-permitted-cross-domain-policies": "none",
        "x-xss-protection": "0",
        "vary": "Origin",
        "access-control-allow-credentials": "true",
        "ratelimit-policy": "1000;w=900",
        "ratelimit-limit": "1000",
        "ratelimit-remaining": "914",
        "ratelimit-reset": "254",
        "x-request-id": "cb9995d2-91ca-4206-a4cb-902b0f791281",
        "content-type": "application/json; charset=utf-8",
        "content-length": "1057",
        "etag": "W/\"421-4yrXDDO4v216Fwu73Ma3AXuRE6I\"",
        "date": "Thu, 05 Mar 2026 10:56:35 GMT",
        "connection": "keep-alive",
        "keep-alive": "timeout=5"
      },
      "body": {
        "code": 400,
        "msg": "Failed to create series: \nInvalid `prisma.rfid_series.create()` invocation in\nC:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\src\\services\\rfid.service.js:1333:30\n\n  1330 };\n  1331 \n  1332 try {\n→ 1333   await prisma.rfid_series.create({\n           data: {\n             series_name: \"Series E2EAA1D000001-E2EAA1D000010\",\n             start_uid: \"E2EAA1D000001\",\n             end_uid: \"E2EAA1D000010\",\n             content_ref_id: null,\n             ~~~~~~~~~~~~~~\n             question_pack_id: null,\n             question_id: null,\n             notes: null,\n             priority: 0,\n             status: 1,\n         ?   id?: BigInt,\n         ?   created_at?: DateTime | Null,\n         ?   updated_at?: DateTime | Null,\n         ?   rfid_pack?: rfid_packCreateNestedOneWithoutRfid_seriesInput,\n         ?   rfid_question?: rfid_questionCreateNestedOneWithoutRfid_seriesInput\n           }\n         })\n\nUnknown argument `content_ref_id`. Available options are marked with ?.",     
        "data": null
      }
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn
    Request

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "url": "http://localhost:8002/toy/admin/rfid/series/list",
      "method": "GET",
      "headers": {
        "X-Service-Key": "da11d988-f105-4e71-b095-da62ada82189"
      },
      "path": "/toy/admin/rfid/series/list",
      "timeout": 15000
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    Response                                                                                   

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "statusCode": 500,
      "headers": {
        "content-security-policy": "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "cross-origin",
        "origin-agent-cluster": "?1",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=15552000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-dns-prefetch-control": "off",
        "x-download-options": "noopen",
        "x-frame-options": "SAMEORIGIN",
        "x-permitted-cross-domain-policies": "none",
        "x-xss-protection": "0",
        "vary": "Origin",
        "access-control-allow-credentials": "true",
        "ratelimit-policy": "1000;w=900",
        "ratelimit-limit": "1000",
        "ratelimit-remaining": "913",
        "ratelimit-reset": "254",
        "x-request-id": "b0009a6f-8912-428e-b545-ded64712eac7",
        "content-type": "application/json; charset=utf-8",
        "content-length": "419",
        "etag": "W/\"1a3-NMg7Vu0DZ/Mfl3BXRtOLPRJW7Jo\"",
        "date": "Thu, 05 Mar 2026 10:56:35 GMT",
        "connection": "keep-alive",
        "keep-alive": "timeout=5"
      },
      "body": {
        "code": 500,
        "msg": "Failed to fetch series",
        "data": {
          "stack": "Error: Failed to fetch series\n    at Object.getSeriesAll (C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\src\\services\\rfid.service.js:1276:11)\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\n    at async C:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\src\\routes\\rfid.routes.js:1342:20"   
        }
      }
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

 FAIL  api/scenarios/rfid-flow.spec.js
  RFID Flow E2E                                                                                
    Step 1: Create RFID card (6.1)                                                             
      √ should create an RFID card mapping (243 ms)                                            
    Step 2: List RFID cards                                                                    
      √ should include the created card in list (67 ms)                                        
    Step 3: Card lookup (12.3 API part)                                                        
      √ should look up card by rfidUid (1 ms)                                                  
    Step 4: RFID series management                                                             
      × should create an RFID series (29 ms)                                                   
      × should list RFID series (16 ms)                                                        
                                                                                               
  ● RFID Flow E2E › Step 4: RFID series management › should create an RFID series              
                                                                                               
    assert.strictEqual(received, expected)

    Expected value to strictly be equal to:
      200
    Received:
      400

    Message:
      HTTP status 400 !== 200

    400 !== 200


      at Expect._validateStatus (node_modules/pactum/src/models/expect.js:106:14)
      at Expect.validate (node_modules/pactum/src/models/expect.js:47:10)
      at Tosser.validateResponse (node_modules/pactum/src/models/Tosser.js:255:23)
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:219:18)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:18)

  ● RFID Flow E2E › Step 4: RFID series management › should list RFID series

    assert.strictEqual(received, expected)

    Expected value to strictly be equal to:
      200
    Received:
      500

    Message:
      HTTP status 500 !== 200

    500 !== 200


      at Expect._validateStatus (node_modules/pactum/src/models/expect.js:106:14)
      at Expect.validate (node_modules/pactum/src/models/expect.js:47:10)
      at Tosser.validateResponse (node_modules/pactum/src/models/Tosser.js:255:23)
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:219:18)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:18)

  console.warn
    Request

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "url": "http://localhost:8002/toy/content/library",
      "method": "POST",
      "headers": {
        "X-Service-Key": "da11d988-f105-4e71-b095-da62ada82189"
      },
      "path": "/toy/content/library",
      "body": {
        "title": "e2e-test-music-d1019ea6",
        "contentType": "music",
        "url": "https://cdn.test.com/music/d1019ea6.mp3",
        "category": "test",
        "description": "E2E test music content"
      },
      "timeout": 15000
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    Response                                                                                   

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "statusCode": 400,
      "headers": {
        "content-security-policy": "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "cross-origin",
        "origin-agent-cluster": "?1",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=15552000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-dns-prefetch-control": "off",
        "x-download-options": "noopen",
        "x-frame-options": "SAMEORIGIN",
        "x-permitted-cross-domain-policies": "none",
        "x-xss-protection": "0",
        "vary": "Origin",
        "access-control-allow-credentials": "true",
        "ratelimit-policy": "1000;w=900",
        "ratelimit-limit": "1000",
        "ratelimit-remaining": "912",
        "ratelimit-reset": "254",
        "x-request-id": "5249ddab-1a7b-4a09-913c-dc52a07554b8",
        "content-type": "application/json; charset=utf-8",
        "content-length": "403",
        "etag": "W/\"193-Yx1Inu6jq//X3MaziZvOZ+Vg+RE\"",
        "date": "Thu, 05 Mar 2026 10:56:35 GMT",
        "connection": "keep-alive",
        "keep-alive": "timeout=5"
      },
      "body": {
        "code": 400,
        "msg": "\nInvalid `prisma.content_library.create()` invocation in\nC:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\src\\services\\content.service.js:161:48\n\n  158 const metadata = {};\n  159 if (data.filename) metadata.filename = data.filename;\n  160 \n→ 161 const content = await prisma.content_library.create(\nUnique constraint failed on the fields: (`id`)",
        "data": null
      }
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn
    Request

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "url": "http://localhost:8002/toy/content/library",
      "method": "POST",
      "headers": {
        "X-Service-Key": "da11d988-f105-4e71-b095-da62ada82189"
      },
      "path": "/toy/content/library",
      "body": {
        "title": "e2e-test-story-0a81e7ce",
        "contentType": "story",
        "url": "https://cdn.test.com/story/0a81e7ce.mp3",
        "category": "test",
        "description": "E2E test story content"
      },
      "timeout": 15000
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    Response                                                                                   

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "statusCode": 400,
      "headers": {
        "content-security-policy": "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "cross-origin",
        "origin-agent-cluster": "?1",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=15552000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-dns-prefetch-control": "off",
        "x-download-options": "noopen",
        "x-frame-options": "SAMEORIGIN",
        "x-permitted-cross-domain-policies": "none",
        "x-xss-protection": "0",
        "vary": "Origin",
        "access-control-allow-credentials": "true",
        "ratelimit-policy": "1000;w=900",
        "ratelimit-limit": "1000",
        "ratelimit-remaining": "911",
        "ratelimit-reset": "253",
        "x-request-id": "cfba59ba-8de5-4c52-b799-dc2ca8d17e2c",
        "content-type": "application/json; charset=utf-8",
        "content-length": "403",
        "etag": "W/\"193-Yx1Inu6jq//X3MaziZvOZ+Vg+RE\"",
        "date": "Thu, 05 Mar 2026 10:56:35 GMT",
        "connection": "keep-alive",
        "keep-alive": "timeout=5"
      },
      "body": {
        "code": 400,
        "msg": "\nInvalid `prisma.content_library.create()` invocation in\nC:\\Users\\Acer\\Cheeko-esp32-server\\main\\manager-api-node\\src\\services\\content.service.js:161:48\n\n  158 const metadata = {};\n  159 if (data.filename) metadata.filename = data.filename;\n  160 \n→ 161 const content = await prisma.content_library.create(\nUnique constraint failed on the fields: (`id`)",
        "data": null
      }
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    Request                                                                                    

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "url": "http://localhost:8002/toy/content/library",
      "method": "GET",
      "headers": {
        "X-Service-Key": "da11d988-f105-4e71-b095-da62ada82189"
      },
      "path": "/toy/content/library",
      "timeout": 15000
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    Response                                                                                   

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "statusCode": 401,
      "headers": {
        "content-security-policy": "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "cross-origin",
        "origin-agent-cluster": "?1",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=15552000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-dns-prefetch-control": "off",
        "x-download-options": "noopen",
        "x-frame-options": "SAMEORIGIN",
        "x-permitted-cross-domain-policies": "none",
        "x-xss-protection": "0",
        "vary": "Origin",
        "access-control-allow-credentials": "true",
        "ratelimit-policy": "1000;w=900",
        "ratelimit-limit": "1000",
        "ratelimit-remaining": "910",
        "ratelimit-reset": "253",
        "x-request-id": "029d79e6-c738-4c2d-86da-f957be689e03",
        "content-type": "application/json; charset=utf-8",
        "content-length": "64",
        "etag": "W/\"40-/3rvFyKVVTuXQe3rQzzEq/odTug\"",
        "date": "Thu, 05 Mar 2026 10:56:35 GMT",
        "connection": "keep-alive",
        "keep-alive": "timeout=5"
      },
      "body": {
        "code": 401,
        "msg": "No authorization token provided",
        "data": null
      }
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    Request                                                                                    

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "url": "http://localhost:8002/toy/content/library?contentType=music",
      "method": "GET",
      "headers": {
        "X-Service-Key": "da11d988-f105-4e71-b095-da62ada82189"
      },
      "queryParams": {
        "contentType": "music"
      },
      "path": "/toy/content/library",
      "timeout": 15000
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    Response                                                                                   

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "statusCode": 401,
      "headers": {
        "content-security-policy": "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "cross-origin",
        "origin-agent-cluster": "?1",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=15552000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-dns-prefetch-control": "off",
        "x-download-options": "noopen",
        "x-frame-options": "SAMEORIGIN",
        "x-permitted-cross-domain-policies": "none",
        "x-xss-protection": "0",
        "vary": "Origin",
        "access-control-allow-credentials": "true",
        "ratelimit-policy": "1000;w=900",
        "ratelimit-limit": "1000",
        "ratelimit-remaining": "909",
        "ratelimit-reset": "253",
        "x-request-id": "8e9bc11b-44b6-4261-89ed-fbd690c536b7",
        "content-type": "application/json; charset=utf-8",
        "content-length": "64",
        "etag": "W/\"40-/3rvFyKVVTuXQe3rQzzEq/odTug\"",
        "date": "Thu, 05 Mar 2026 10:56:35 GMT",
        "connection": "keep-alive",
        "keep-alive": "timeout=5"
      },
      "body": {
        "code": 401,
        "msg": "No authorization token provided",
        "data": null
      }
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

 FAIL  api/scenarios/content-pipeline.spec.js
  Content Delivery Pipeline E2E
    Step 1: Upload music content (5.1)                                                         
      × should create music content (95 ms)                                                    
    Step 2: Upload story content (5.2)                                                         
      × should create story content (35 ms)                                                    
    Step 3: Verify content in library                                                          
      × should find created content in library list (7 ms)                                     
      × should filter content by type (10 ms)                                                  
    Step 4: Get content by ID                                                                  
      √ should retrieve music content by ID (1 ms)                                             
    Step 5: Delete content (5.9)                                                               
      √ should delete story content                                                            
                                                                                               
  ● Content Delivery Pipeline E2E › Step 1: Upload music content (5.1) › should create music content                                                                                          

    assert.strictEqual(received, expected)

    Expected value to strictly be equal to:
      200
    Received:
      400

    Message:
      HTTP status 400 !== 200

    400 !== 200


      at Expect._validateStatus (node_modules/pactum/src/models/expect.js:106:14)
      at Expect.validate (node_modules/pactum/src/models/expect.js:47:10)
      at Tosser.validateResponse (node_modules/pactum/src/models/Tosser.js:255:23)
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:219:18)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:18)

  ● Content Delivery Pipeline E2E › Step 2: Upload story content (5.2) › should create story content

    assert.strictEqual(received, expected)

    Expected value to strictly be equal to:
      200
    Received:
      400

    Message:
      HTTP status 400 !== 200

    400 !== 200


      at Expect._validateStatus (node_modules/pactum/src/models/expect.js:106:14)
      at Expect.validate (node_modules/pactum/src/models/expect.js:47:10)
      at Tosser.validateResponse (node_modules/pactum/src/models/Tosser.js:255:23)
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:219:18)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:18)

  ● Content Delivery Pipeline E2E › Step 3: Verify content in library › should find created content in library list

    assert.strictEqual(received, expected)

    Expected value to strictly be equal to:
      200
    Received:
      401

    Message:
      HTTP status 401 !== 200

    401 !== 200


      at Expect._validateStatus (node_modules/pactum/src/models/expect.js:106:14)
      at Expect.validate (node_modules/pactum/src/models/expect.js:47:10)
      at Tosser.validateResponse (node_modules/pactum/src/models/Tosser.js:255:23)
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:219:18)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:18)

  ● Content Delivery Pipeline E2E › Step 3: Verify content in library › should filter content by type

    assert.strictEqual(received, expected)

    Expected value to strictly be equal to:
      200
    Received:
      401

    Message:
      HTTP status 401 !== 200

    401 !== 200


      at Expect._validateStatus (node_modules/pactum/src/models/expect.js:106:14)
      at Expect.validate (node_modules/pactum/src/models/expect.js:47:10)
      at Tosser.validateResponse (node_modules/pactum/src/models/Tosser.js:255:23)
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:219:18)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:18)

  console.warn
    Request

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "url": "http://localhost:8002/toy/agent/config/e2e207e2710c",
      "method": "GET",
      "headers": {
        "X-Service-Key": "da11d988-f105-4e71-b095-da62ada82189"
      },
      "path": "/toy/agent/config/e2e207e2710c",
      "timeout": 15000
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:53:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    Response                                                                                   

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

  console.warn                                                                                 
    {                                                                                          
      "statusCode": 404,
      "headers": {
        "content-security-policy": "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "cross-origin",
        "origin-agent-cluster": "?1",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=15552000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-dns-prefetch-control": "off",
        "x-download-options": "noopen",
        "x-frame-options": "SAMEORIGIN",
        "x-permitted-cross-domain-policies": "none",
        "x-xss-protection": "0",
        "vary": "Origin",
        "access-control-allow-credentials": "true",
        "ratelimit-policy": "1000;w=900",
        "ratelimit-limit": "1000",
        "ratelimit-remaining": "907",
        "ratelimit-reset": "253",
        "x-request-id": "b4e36e14-2345-4695-bad4-755d6210e3fa",
        "content-type": "application/json; charset=utf-8",
        "content-length": "58",
        "etag": "W/\"3a-mWyyTn0dh7bWDA1Gij5+ptw5tjo\"",
        "date": "Thu, 05 Mar 2026 10:56:36 GMT",
        "connection": "keep-alive",
        "keep-alive": "timeout=5"
      },
      "body": {
        "code": 404,
        "msg": "Device or agent not found",
        "data": null
      }
    }

      at node_modules/pactum/src/adapters/logger.js:21:24
          at Array.forEach (<anonymous>)
      at Object.warn (node_modules/pactum/src/adapters/logger.js:21:7)
      at Logger.warn (node_modules/pactum/src/plugins/logger.js:78:20)
      at Object.printReqAndRes (node_modules/pactum/src/helpers/utils.js:54:9)
      at Tosser.printRequestAndResponse (node_modules/pactum/src/models/Tosser.js:266:13)      
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:228:12)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:7)

 FAIL  api/scenarios/device-lifecycle.spec.js
  Device Lifecycle E2E
    Step 1: Register device                                                                    
      √ should register a new device via manual-add (159 ms)                                   
    Step 2: Retrieve device config (2.2)                                                       
      × should return config for the registered device MAC (44 ms)                             
    Step 3: Duplicate MAC rejection (2.6)                                                      
      √ should reject registration with same MAC address (93 ms)                               
    Step 4: Get device list with pagination (2.7)                                              
      √ should return paginated device list (35 ms)                                            
                                                                                               
  ● Device Lifecycle E2E › Step 2: Retrieve device config (2.2) › should return config for the registered device MAC                                                                          

    assert.strictEqual(received, expected)

    Expected value to strictly be equal to:
      200
    Received:
      404

    Message:
      HTTP status 404 !== 200

    404 !== 200


      at Expect._validateStatus (node_modules/pactum/src/models/expect.js:106:14)
      at Expect.validate (node_modules/pactum/src/models/expect.js:47:10)
      at Tosser.validateResponse (node_modules/pactum/src/models/Tosser.js:255:23)
      at Tosser.validate (node_modules/pactum/src/models/Tosser.js:219:18)
      at Tosser.toss (node_modules/pactum/src/models/Tosser.js:46:18)

  console.log
      Skipping: FIREBASE_TEST_TOKEN not configured

      at Object.log (api/scenarios/profile-flow.spec.js:34:17)

  console.log                                                                                  
      Skipping: FIREBASE_TEST_TOKEN not configured                                             

      at Object.log (api/scenarios/profile-flow.spec.js:97:17)

 PASS  api/scenarios/profile-flow.spec.js
  Profile Flow E2E                                                                             
    Step 1: Create kid profile (7.1)                                                           
      √ should create a kid profile via mobile API (6 ms)                                      
    Step 2: Retrieve profile                                                                   
      √ should return the created profile                                                      
    Step 3: Update profile (7.2)                                                               
      √ should update profile name and interests (1 ms)                                        
      √ should reflect updated name (1 ms)                                                     
    Step 4: List profiles                                                                      
      √ should list profiles via mobile API (1 ms)                                             
                                                                                               
Test Suites: 6 failed, 2 passed, 8 total                                                       
Tests:       14 failed, 34 passed, 48 total                                                    
Snapshots:   0 total
Time:        4.36 s
Ran all test suites matching /api\\scenarios/i.

  E2E Teardown: Complete

