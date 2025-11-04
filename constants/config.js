const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:4173",
    'https://main.d3k1zyegsyaj9.amplifyapp.com'
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
};

const CHATTU_TOKEN = "chattu-token";

export { corsOptions, CHATTU_TOKEN };
