const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const port = 3000;
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const Message = require('./models/Message')
const ws = require("ws");
const fs = require ('fs');
const { log } = require("console");

dotenv.config();

const jwtSecret = process.env.JWT_SECRET;
const bcryptSalt = bcrypt.genSaltSync(10);

async function connectToDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}
connectToDatabase();

const app = express();
app.use('/uploads', express.static(__dirname + '/uploads'))
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

async function getUserDataFromRequest(res) {
  return new Promise((resolve, reject) => {
        const token = req.cookies?.token;
  if (token) {
    jwt.verify(token, process.env.JWT_SECRET, (err, userData) => {
      if (err) throw err;
      resolve(userData)
    });
  } else {
    reject ('no token')
  }
  })

}

app.get("/test", (req, res) => {
  res.send("Test ok");
});

app.get('/messages/:userId', async(req,res) => {
  // res.json(res.params)
  const { userId } = req.params
  const userData = await getUserDataFromRequest(req)
  const ourUserId = userData.userId
  const messages = await Message.find({
    sender: { $in: [userId,ourUserId]},
    recipient: {$in:[userId,ourUserId]}
  }).sort({ createdAt: 1 })
  res.json(messages)
})

app.get('/people', async (req, res) => {
  const users = await User.find({}, { '_id':1, username: 1})
  res.json(users)
})

app.get("/api/profile", (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    jwt.verify(token, process.env.JWT_SECRET, (err, userData) => {
      if (err) throw err;
      res.json(userData);
    });
  } else {
    res.status(401).json("no token");
  }
});
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const foundUser = await User.findOne({ username });
  if (foundUser) {
    const passOk = bcrypt.compareSync(password, foundUser.password);
    if (passOk) {
      jwt.sign(
        { userId: foundUser._id, username },
        process.env.JWT_SECRET,
        (err, token) => {
          console.log(token);
          res.cookie("token", token);
          res.json({
            id: foundUser._id,
          });
        }
      );
    }
  }
});
app.post('/logout', (req, res) => {
  res.cookie('token', '', {sameSite:'none', secure:true}).json('ok')
})

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  console.log(username, password);
  try {
    const hashedPassword = bcrypt.hashSync(password, bcryptSalt);
    const createdUser = await User.create({
      username: username,
      password: hashedPassword,
    });
    const token = jwt.sign(
      { userId: createdUser._id, username },
      process.env.JWT_SECRET,
      (err, token) => {
        if (err) throw err;
      }
    );

    // if (err) throw err
    res.cookie("token", token, { secure: true }).status(201).json({
      id: createdUser._id,
    });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json(error);
  }
});

const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const wss = new ws.WebSocketServer({ server });
wss.on("connection", (connection, req) => {

  function notifyAboutOnlinePeople() {
      [...wss.clients].forEach(client => {
    client.send(
      JSON.stringify({
        online: [...wss.clients].map((c) => ({
          userId: c.userId,
          username: c.username,
        })),
      })
    );
  });
  }

  connection.isAlive = true;

  connection.timer = setInterval(() => {
    connection.ping()
    connection.deathTimer = setTimeout(() => {
      connection.isAlive = false;
      clearInterval(connection.timer)
      connection.terminate();
      notifyAboutOnlinePeople();
      console.log('dead');
    }, 1000)
  }, 5000);

  connection.on('pong', () => {
    clearTimeout(connection.deathtimer)
  })
  // console.log('connected');
  // connection.send('hello')


  //read username and id from the cookie for this connection
  console.log("connected");
  const cookies = req.headers.cookie;
  if (cookies) {
    const tokenCookieString = cookies
      .split(";")
      .find((str) => str.startsWith(" token="));

    if (tokenCookieString) {
      // console.log(tokenCookieString);
      const token = tokenCookieString.split("=")[1];
      if (token) {
        // console.log(token);
        jwt.verify(token, jwtSecret, {}, (err, userData) => {
          if (err) throw err;
          const { userId, username } = userData;
          connection.userId = userId;
          connection.username = username;
        });
      }
    }
  }
  connection.on('message', async(message) => {
    const messageData = JSON.parse(message.toString())
    const { recipient, text, file } = messageData
    let filename = null
    if (file) {
      console.log('size', file.data.length);
      const parts = file.name.split('.')
      const ext = parts[parts.length - 1]
      filename = Date.now() + '.' + ext;
      const path = __dirname + '/uploads/' + filename
      const bufferData = new Buffer(file.data.split(',')[1], 'base64')
      fs.writeFile(path, bufferData, () => {
        console.log('file saved:'+ path);
      })
    }
    if (recipient && (text || file)) {
     const messageDoc = await Message.create({
        sender: connection.userId,
        recipient,
       text,
        file: file ? filename: null,
     });
      console.log('created message');
      [...wss.clients]
      .filter(c => c.userId === recipient)
        .forEach(c => c.send(JSON.stringify({
          text,
          sender: connection.userId,
          recipient,
          file: file ? filename : null,
          _id: messageDoc._id,
        })))
    }
    // console.log(messageData);
  });
  // console.log([...wss.clients].map(c => c.username));
  
  
  //notify everyone about online when someone connects
notifyAboutOnlinePeople()
});

// wss.on('close', data => {
//   console.log('disconnect', data);
// });

//A4rpydAK2hR22L3c
