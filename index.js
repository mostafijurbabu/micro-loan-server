const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.PORT || 5000;
const crypto = require("crypto");

const admin = require("firebase-admin");

const serviceAccount = require("./micro-loan-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const prefix = "APP-PAY";

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `${prefix}-${date}-${random}`;
}

app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded in the token", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.egme4zl.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server
    await client.connect();

    const db = client.db("micro_loan_db");
    const userCollection = db.collection("users");
    const loansCollection = db.collection("loans");
    const applicationsCollection = db.collection("applications");
    const paymentCollection = db.collection("payments");

    //Admin Only Middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email });

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "Admin access only" });
      }
      next();
    };

    // Manager Middleware
    const verifyManager = async (req, res, next) => {
      try {
        const email = req.decoded_email;

        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(401).send({ message: "User not found" });
        }

        if (user.role !== "manager" && user.role !== "admin") {
          return res.status(403).send({ message: "Manager access only" });
        }

        next();
      } catch (error) {
        console.error("verifyManager error:", error);
        res.status(500).send({ message: "Server error" });
      }
    };

    // users related api
    app.get("/users", verifyFBToken, async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:id", async (req, res) => {});

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date();
      const email = user.email;
      const userExists = await userCollection.findOne({ email });

      if (userExists) {
        return res.send({ message: "user exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;

      const result = await userCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );

      res.send(result);
    });

    // loans api

    app.get("/loans", async (req, res) => {
      const cursor = loansCollection.find().limit(6).sort({ maxLoanLimit: 1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/loans", verifyFBToken, verifyManager, async (req, res) => {
      const loan = {
        ...req.body,
        createdBy: req.decoded_email,
        createdAt: new Date(),
      };

      const result = await loansCollection.insertOne(loan);
      res.send(result);
    });

    app.get(
      "/loans/manager",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const email = req.decoded_email;

          const result = await loansCollection
            .find({ createdBy: email })
            .sort({ createdAt: -1 })
            .toArray();

          res.send(result);
        } catch (error) {
          console.error("Manager loans error:", error);
          res.status(500).send({ message: "Failed to load manager loans" });
        }
      }
    );

    app.get("/loans/:id", async (req, res) => {
      const { id } = req.params;
      const objectId = new ObjectId(id);

      const result = await loansCollection.findOne({ _id: objectId });

      res.send(result);
    });

    app.patch("/loans/:id", verifyFBToken, verifyManager, async (req, res) => {
      const id = req.params.id;

      const result = await loansCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body }
      );

      res.send(result);
    });

    app.delete("/loans/:id", verifyFBToken, verifyManager, async (req, res) => {
      const id = req.params.id;

      const result = await loansCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // applications api

    app.post("/applications", async (req, res) => {
      const appData = {
        ...req.body,
        status: "pending",
        appliedAt: new Date(),
      };

      const result = await applicationsCollection.insertOne(appData);
      res.send(result);
    });

    app.delete("/applications/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await applicationsCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/applications", async (req, res) => {
      const borrowerEmail = req.query.email;

      let query = {};
      if (borrowerEmail) {
        query = { borrowerEmail: borrowerEmail };
      }

      const result = await applicationsCollection.find(query).toArray();
      res.send(result);
    });

    app.get(
      "/applications/approved",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        try {
          const result = await applicationsCollection
            .find({ status: "approved" })
            .toArray();

          res.send(result);
        } catch (error) {
          console.error("Approved applications error:", error);
          res.status(500).send({
            message: "Approved loan fetch failed",
          });
        }
      }
    );

    app.get(
      "/applications/pending",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        const result = await applicationsCollection
          .find({ status: "pending" })
          .toArray();

        res.send(result);
      }
    );

    app.get("/applications/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid application ID" });
      }

      const objectId = new ObjectId(id);

      const result = await applicationsCollection.findOne({ _id: objectId });

      res.send(result);
    });

    app.patch(
      "/applications/status/:id",
      verifyFBToken,
      verifyManager,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;

        const update = { status };

        if (status === "approved") {
          update.approvedAt = new Date();
        }

        const result = await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: update }
        );

        res.send(result);
      }
    );

    // Get payment by applicationId (for Paid modal)
    app.get("/payments/by-application/:applicationId", async (req, res) => {
      const { applicationId } = req.params;

      try {
        const payment = await paymentCollection.findOne({
          applicationId: applicationId,
        });

        if (!payment) {
          return res.status(404).send({ message: "Payment not found" });
        }

        res.send(payment);
      } catch (error) {
        res.status(500).send({ message: "Server error" });
      }
    });

    // payment related apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: 1000,
              product_data: {
                name: "Loan Application Fee",
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo.userEmail,
        mode: "payment",
        metadata: {
          applicationId: paymentInfo.applicationId,
          applicantName: paymentInfo.applicantName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;

      if (!sessionId)
        return res.status(400).send({ message: "Missing session_id" });

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const transactionId = session.payment_intent;
        const query = { transactionId: transactionId };

        const paymentExist = await paymentCollection.findOne(query);
        console.log(paymentExist);

        if (paymentExist) {
          return res.send({
            message: "already exists",
            transactionId,
            trackingId: paymentExist.trackingId,
          });
        }

        const trackingId = generateTrackingId();

        if (session.payment_status === "paid") {
          const id = session.metadata.applicationId;
          const query = { _id: new ObjectId(id) };
          const update = {
            $set: {
              applicationFeeStatus: "paid",
              trackingId: trackingId,
            },
          };
          const result = await applicationsCollection.updateOne(query, update);

          const payment = {
            amount: session.amount_total / 100,
            currency: session.currency,
            customerEmail: session.customer_email,
            applicationId: id,
            applicantName: session.metadata.applicantName,
            transactionId: session.payment_intent,
            paymentStatus: session.payment_status,
            paidAt: new Date(),
            trackingId: trackingId,
          };

          const resultPayment = await paymentCollection.insertOne(payment);

          return res.send({
            success: true,
            modifyApplicant: result,
            trackingId,
            transactionId,
            paymentInfo: resultPayment,
          });
        }

        res.send({ success: false });
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: "Something went wrong!" });
      }
    });

    app.get("/payments", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      // console.log("Headers", req.headers);

      if (email) {
        query.customerEmail = email;

        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "forbidden access" });
        }
      }
      const cursor = paymentCollection.find(query).sort({ paidAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // profile api
    app.get("/profile", verifyFBToken, async (req, res) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email });
      res.send(user);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Micro Loan is on!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
