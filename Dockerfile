FROM node:20

RUN apt-get update && apt-get install -y python3 make g++ git

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN git clone --depth 1 https://github.com/xrahat-dev2/Xrahat-BoT.git /tmp/xr \
 && mkdir -p includes \
 && cp -r /tmp/xr/includes/Fca includes/Fca \
 && rm -rf /tmp/xr

CMD ["npm", "start"]
