const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const cors = require('cors');
const schedule = require('node-schedule');
const moment = require('moment');
const admin = require('firebase-admin');
const https = require('https');
const fs = require('fs');
const sgMail = require('@sendgrid/mail');
const sharp = require('sharp');

const app = express();
app.use(bodyParser.urlencoded({extended: true, limit: '50mb'}));
dotenv.config();
sgMail.setApiKey(process.env.SENDGRID);

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

function deleteDoc(id, current){
    const time = new Date(
        moment()
            .year(current.getUTCFullYear())
            .month(current.getMonth())
            .date(current.getUTCDate())
            .hour(current.getUTCHours())
            .minute(current.getUTCMinutes())
            .add(30, "days")
            .format("yyyy/MM/DD HH:mm")
    );

    console.log('Deletion entered');

    schedule.scheduleJob(time, function () {
        console.log('CRON STARTED for deleting');
        const docRef = db.collection('parking').doc(id);
        docRef.get().then(doc=>{
            if(doc.exists){
                const res = docRef.delete();
                console.log("Deleted res: ", res);
            }
        });
        console.log('CRON END');
    });

    console.log('Deletion scheduled');
}

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
                .add(24, "hours")
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
                if(doc.exists){
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
                }
            });
            console.log('CRON END');
        });

        ///delete document
        deleteDoc(id, current);

        res.send({status: 'successful'});
    }
    catch (e){
        res.send( {status: 'failed'});
    }

});

app.post("/expire", cors(corsConfig), (req, res) => {
    try{
        const current = new Date();
        const time = new Date(
            moment()
                .year(current.getUTCFullYear())
                .month(current.getMonth())
                .date(current.getUTCDate())
                .hour(current.getUTCHours())
                .minute(current.getUTCMinutes())
                .add(15, "minutes")
                .format("yyyy/MM/DD HH:mm")
        );
        const id = req.body.id;

        console.log(id);
        console.log(current);

        schedule.scheduleJob(time, function () {
            console.log('CRON STARTED FOR EXPIRE');
            const docRef = db.collection('parking').doc(id);
            docRef.get().then(async doc => {
                if(doc.exists){
                    const isPending = doc.data().status === 'pending';
                    if (isPending) {
                        console.log("PENDING");
                        try {
                            const res = await db.collection('parking').doc(id).delete();
                            console.log(res);
                        } catch (e) {
                            console.log(e);
                        }
                    } else {
                        console.log("NOT PENDING");
                    }
                }
            });
            console.log('CRON END FOR EXPIRE');
        });
        res.send({status: 'successful'});
    }
    catch (e){
        res.send( {status: 'failed'});
    }

});

app.post("/plateRecognize", cors(corsConfig), (request, response) => {

    ///do compression
    const base64str = request.body.image;
    let base64Image = base64str.split(';base64,').pop();
    let img = new Buffer(base64Image, 'base64');

    sharp(img)
        .rotate()
        .resize({ height: 2048 })
        .toBuffer()
        .then(async resizedImageBuffer => {
            let resizedImageData = resizedImageBuffer.toString('base64');
            let resizedBase64 = `data:image/jpg;base64,${resizedImageData}`;

            ///send to api
            let message = {
                'upload' : resizedBase64.toString(),
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
                response.status(400).send(e);
            });

            req.write(JSON.stringify(message));
            req.end();

        })
        .catch(error => {
            response.status(400).send(error);
        });
});

app.post('/sendEmail', cors(corsConfig), (req, res) => {
    const email = req.body.email;
    const role = req.body.role;
    const password = req.body.password;
    const msg = {
        to: email, // Change to your recipient
        from: {
            name: 'Prkcar',
            email: 'noreply@prkcar.com',
        },
        subject: 'Prkcar Admin',
        text: "You have added to the prkcar.com as "+role+" and please use following login credentials to log into your portal.\n\n" +
            "Login URL: https://prkcar.com/admin\n\n" +
            "Email: "+email+"\n\n" +
            "Password: "+password+"\n\n" +
            "Please keep above credentials private.\n\n" +
            "Thank You\n" +
            "Team Prkcar",
    }
    sgMail
        .send(msg)
        .then(() => {
            console.log('Email sent to '+email);
            res.send({status: 'successful'});
        })
        .catch((error) => {
            console.error(error+' -> '+email);
            res.send({status: 'failed', error: error});
        });
});

app.get('/deleteUser/:email', cors(corsConfig), (req, res)=>{
    const email = req.params.email;
    admin.auth().getUserByEmail(email).then((userRecord) => {
        const uid = userRecord.toJSON()['uid'];
        console.log(uid);
        //delete user

        admin.auth().deleteUser(uid).then(() => {
                console.log('Successfully deleted user');
                res.send({'status': 'done'});
            }).catch((error) => {
                console.log('Error deleting user:', error);
                res.status(400).send(error.toString());
            });

    }).catch((error) => {
            console.log('Error fetching user data:', error);
            res.status(400).send(error.toString());
    });
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