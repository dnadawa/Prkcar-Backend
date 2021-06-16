const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const cors = require('cors');
const cron = require('node-cron');
const moment = require('moment');
const admin = require('firebase-admin');

const app = express();
app.use(bodyParser.urlencoded({extended: true}));
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

app.post("/sendInit", cors(corsConfig), (req, res) => {
    console.log("POST started");
    const phone = req.body.phone;
    const license = req.body.license;
    const endTime = req.body.time;
    const url = req.body.url;

    console.log(phone);
    console.log(license);
    console.log(endTime);
    console.log(url);

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const client = require('twilio')(accountSid, authToken);

    try{
        client.messages
            .create({
                body: 'Your vehicle is parked. License plate '+license+'. Your time will expire at '+endTime+'. Use following link to confirm parking '+url,
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
    console.log("Current :"+ new Date());
    console.log("Requested: "+ req.body.time);

    const current = new Date();
    const time = new Date(
        moment()
            .year(current.getUTCFullYear())
            .month(current.getMonth())
            .date(current.getUTCDate())
            .hour(current.getUTCHours())
            .minute(current.getUTCMinutes())
            .add(3, "minutes")
            .format("yyyy/MM/DD HH:mm")
    );

    // const time = new Date(req.body.time);
    const id = req.body.id;
    console.log("Processed: "+time);
    console.log("Cron :"+time.getUTCMinutes()+"m and "+time.getUTCHours()+" h");

    const task = cron.schedule(time.getUTCMinutes()+' '+time.getUTCHours()+' * * *', function () {
        console.log('cron run');
        const docRef = db.collection('parked').doc(id);
        docRef.get().then(doc=>{
            const isParked = doc.data().parked;
            if(isParked){
                ///rest of things
                console.log("Currently parking");
            }
        });
        task.stop();
    });
    res.send();
});

app.get('/', (req, res) => {
    res.send("<h1>Hello</h1>");
});

app.listen(5000,() => console.log('Server started on port 3000'));