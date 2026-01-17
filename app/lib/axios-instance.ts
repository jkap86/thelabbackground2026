import axios from "axios";
import axiosRetry from "axios-retry";
import https from "https";

const axiosInstance = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
  httpsAgent: new https.Agent({
    keepAlive: true,
    maxSockets: 10,
  }),
  timeout: 15000,
});

axiosRetry(axiosInstance, {
  retries: 5,
  retryDelay: (retryCount) => {
    console.log(`retry attempt: ${retryCount}`);
    return 3000 + retryCount * 2000;
  },
  retryCondition: (error) => {
    return axiosRetry.isNetworkOrIdempotentRequestError(error);
  },
});

export default axiosInstance;
