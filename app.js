const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const cors = require('cors');
const schedule = require('node-schedule');
const moment = require('moment');
const admin = require('firebase-admin');
const https = require('https');
const fs = require('fs');

const app = express();
app.use(bodyParser.urlencoded({extended: true, limit: '50mb'}));
dotenv.config();

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const corsConfig = {
    origin: "*",
    methods: ["POST", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type"],
    preflightContinue: true
}

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);

app.post("/send", cors(corsConfig), (req, res) => {
    const phone = req.body.phone;
    const messageBody = req.body.message;

    console.log(phone);

    try{
        client.messages
            .create({
                // body: 'Your vehicle is parked. License plate '+license+'. Your time will expire at '+endTime+'. Use following link to confirm parking '+url,
                body: messageBody,
                from: '+15407798532',
                to: phone
            })
            .then((message) => {
                console.log(message.sid);
                res.send({'sid': message.sid, status: 'successful'});
            }
            );
    }
    catch (e) {
        console.log(e);
        res.send({status: "failed"});
    }
});

app.post("/sendSchedule", cors(corsConfig), (req, res) => {
    try{
        const current = new Date();
        const time = new Date(
            moment()
                .year(current.getUTCFullYear())
                .month(current.getMonth())
                .date(current.getUTCDate())
                .hour(current.getUTCHours())
                .minute(current.getUTCMinutes())
                .add(5, "minutes")
                .format("yyyy/MM/DD HH:mm")
        );
        const id = req.body.id;
        const phone = req.body.phone;

        console.log(id);
        console.log(phone);
        console.log(current);

        schedule.scheduleJob(time, function () {
            console.log('CRON STARTED');
            const docRef = db.collection('parking').doc(id);
            docRef.get().then(doc=>{
                const isParked = doc.data().status==='parked';
                if(isParked){
                    console.log("PARKING");
                    try{
                        client.messages
                            .create({
                                body: 'Your allocated parking time will expire in 15 minutes.',
                                from: '+15407798532',
                                to: phone
                            })
                            .then((message) => {
                                    console.log(message.sid);
                                }
                            );
                    }
                    catch (e) {
                        console.log(e);
                    }
                }
                else{
                    console.log("NOT PARKING");
                }
            });
            console.log('CRON END');
        });
        res.send({status: 'successful'});
    }
    catch (e){
        res.send( {status: 'failed'});
    }

});

app.post("/plateRecognize", cors(corsConfig), (request, response) => {
    let message = {
        'upload' : request.body.image.toString(),
        'mmc': true
    };

    let headers = {
        "Authorization": "Token "+process.env.PLATERECOGNIZER,
        'Content-Type': 'application/json',
    };

    let options = {
        host: "api.platerecognizer.com",
        port: 443,
        path: "/v1/plate-reader",
        method: "POST",
        headers: headers
    };

    let req = https.request(options, function(res) {
        res.on('data', function(data) {
            console.log("Response:");
            console.log(JSON.parse(data));
            response.send(JSON.parse(data));
        });
    });

    req.on('error', function(e) {
        console.log("ERROR:");
        console.log(e);
        response.send(e);
    });

    req.write(JSON.stringify(message));
    req.end();
});

app.get('/', (req, res) => {
    res.send("<h1>Hello</h1>");
});

// app.listen(3000, () => console.log('Server started'));

const privateKey = fs.readFileSync('/etc/letsencrypt/live/api.prkcar.com/privkey.pem', 'utf8');
const certificate = fs.readFileSync('/etc/letsencrypt/live/api.prkcar.com/cert.pem', 'utf8');
const ca = fs.readFileSync('/etc/letsencrypt/live/api.prkcar.com/chain.pem', 'utf8');

const credentials = {
    key: privateKey,
    cert: certificate,
    ca: ca
};

https.createServer(credentials, app)
    .listen(5000, function () {
        console.log('Server started on port 5000')
    })