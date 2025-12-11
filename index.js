const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");

const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

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
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("micro_loan_db");
    const loansCollection = db.collection("loans");

    app.get("/loans", async (req, res) => {
      const cursor = loansCollection.find().sort({ maxLoanLimit: 1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/loans", async (req, res) => {
      const newLoan = req.body;
      const result = await loansCollection.insertOne(newLoan);
      res.send(result);
    });

    app.get("/loans/:id", async (req, res) => {
      const { id } = req.params;
      const objectId = new ObjectId(id);

      const result = await loansCollection.findOne({ _id: objectId });

      res.send({
        success: true,
        result,
      });
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
