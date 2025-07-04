const {AbiCoder, ethers} = require('ethers');
require('dotenv').config();

// Import the contract ABI
const {abi} = require('./MachineStationFactoryABI.json');

const rpcURL = 'https://wss-async.agung.peaq.network';
const chainID = 9990;

const failedDeployments = {};

// Contract details
const MachineStationFactoryContractAddress =
    process.env
        .MACHINE_STATION_CONTRACT_ADDRESS;  // Replace with the deployed Machine
                                            // station factory contract address

const contract =
    new ethers.ContractFactory(abi, MachineStationFactoryContractAddress);

// Wallet details
const stationAdminPrivateKey1 = process.env.STATION_ADMIN_1_PRIVATE_KEY;  // first station admin
const stationAdminPrivateKey2 = process.env.STATION_ADMIN_2_PRIVATE_KEY;  // second station admin
const stationManagerPrivateKey1 = process.env.STATION_MANAGER_1_PRIVATE_KEY;  // first station manager
const stationManagerPrivateKey2 = process.env.STATION_MANAGER_2_PRIVATE_KEY;  // second station manager

const provider = new ethers.JsonRpcProvider(rpcURL);

const stationAdminAccount1 = new ethers.Wallet(stationAdminPrivateKey1, provider);
const stationAdminAccount2 = new ethers.Wallet(stationAdminPrivateKey2, provider);
const stationManagerAccount1 = new ethers.Wallet(stationManagerPrivateKey1, provider);
const stationManagerAccount2 = new ethers.Wallet(stationManagerPrivateKey2, provider);

console.log({
  stationManager1: stationManagerAccount1.address,
  stationManager2: stationManagerAccount2.address,
});

async function signTypedDataDeployMachineSmartAccount(machineOwner, nonce) {
  // Define the EIP-712 Domain
  const domain = {
    name: 'MachineStationFactory',
    version: '1',
    chainId: chainID,
    verifyingContract: MachineStationFactoryContractAddress,
  };

  // Define the type definition for the data
  const types = {
    DeployMachineSmartAccount: [
      {name: 'machineOwner', type: 'address'},
      {name: 'nonce', type: 'uint256'},
    ],
  };

  // Define the data to be signed
  const message = {
    machineOwner: machineOwner,
    nonce: nonce,
  };

  // Sign the typed data
  const signature =
      await stationAdminAccount1.signTypedData(domain, types, message);

  return signature;
}

function getRandomNumber() {
  const now = BigInt(Date.now());
  const randomPart = BigInt(Math.floor(Math.random() * 1e18));
  return now * randomPart;
}

function encodeDeploySmartAccountMethod(machineOwner, nonce, signature) {
  // Encode the method call data
  return contract.interface.encodeFunctionData(
      'deployMachineSmartAccount', [machineOwner, nonce, signature]);
}

// Functions to interact with the contract
async function deployMachineSmartAccount(
    machineOwner, methodData, stationManager) {
  try {
    // Send the transaction and get the receipt
    const tx = {
      to: MachineStationFactoryContractAddress,
      data: methodData,
    };

    const txResponse = await stationManager.sendTransaction(tx);
    let receipt = await txResponse.wait().finally();

    const logs = receipt?.logs;

    // Compute the event signature
    const eventSignature = ethers.id('MachineSmartAccountDeployed(address)');
    console.log('eventSignature: ', eventSignature);

    // Find the relevant log
    const log = logs?.find((log) => log.topics[0] === eventSignature);
    if (!log) {
      throw new Error('MachineSmartAccountDeployed event not found in logs');
    }

    // The deployed address is stored as the second topic (topics[1]) in a
    // 32-byte format
    const rawDeployedAddress = log.topics[1];
    const deployedAddress = ethers.getAddress(
        `0x${rawDeployedAddress.slice(26)}`);  // Extract last 20 bytes

    console.log('Machine Deploy Tx executed:', receipt?.hash);
    console.log(`Machine Deployed Address: ${deployedAddress} \n\n`);

    if (machineOwner in failedDeployments) {
      delete failedDeployments[machineOwner];
    }

    return deployedAddress;

  } catch (error) {
    // add the machine owner address to the failDeployment var
    failedDeployments[machineOwner] = machineOwner;
    console.error('Transaction failed. Error:', error);

    // Check if the error is a revert error with data
    if (error.data) {
      try {
        // Decode the revert error using the contract's ABI
        const iface = new ethers.Interface(contract.interface.fragments);
        const decodedError = iface.parseError(error.data);

        console.log('Decoded Error:', decodedError);

      } catch (decodeError) {
        console.error('Failed to decode error data:', decodeError);
      }
    } else {
      console.error('Transaction failed without revert data:', error);
    }
  }
}

async function processDeployment() {
  console.error('processDeployment() hittss');
  //   total number of machines to be created
  let totalRequest = 20;

  for (let index = 0; index < totalRequest; index++) {
    let newMachineOwnerWallet = ethers.Wallet.createRandom(provider);
    let newMachineOwner = newMachineOwnerWallet.address;
    let nonce = getRandomNumber();
    let signature =
        await signTypedDataDeployMachineSmartAccount(newMachineOwner, nonce);

    // // REMOVE IN PRODUCTION CODE: THIS IS USED TO SIMULATE FAILURE SO RETRY CAN BE TESTED
    // //  set an invalid nonce on every 5th item so that the transaction
    // // submission will throw an error
    // if ((index + 1) % 5 == 0) {
    //   console.log('invalid nonce set!: ', index + 1);
    //   nonce = getRandomNumber();
    // }

    let methodData = encodeDeploySmartAccountMethod(newMachineOwner, nonce, signature);
    
    console.log(`Deploying Machine: ${index + 1}`);
    // used first station manager
    await deployMachineSmartAccount(newMachineOwner, methodData, stationManagerAccount1);
  }
}

async function retryFailedDeployments() {
  console.error('retryFailedDeployments() hittss');
  console.error('current failedDeployments: ', failedDeployments);

  for (const [_, value] of Object.entries(failedDeployments)) {
    let newMachineOwner = value;
    let nonce = getRandomNumber();
    console.error('retryFailedDeployments: newMachineOwner: ', newMachineOwner);


    let signature =
        await signTypedDataDeployMachineSmartAccount(newMachineOwner, nonce);
    let methodData =
        encodeDeploySmartAccountMethod(newMachineOwner, nonce, signature);
    // used second station manager
    await deployMachineSmartAccount(
        newMachineOwner, methodData, stationManagerAccount2);
  }
}

(async () => {
  let retryInProgress = false;
  async function runRetryCycle() {
    console.log("runRetryCycle hitts");
    if (retryInProgress) return;

    retryInProgress = true;
    try {
      await retryFailedDeployments();
    } catch (error) {
      console.error('Error occurred during retry:', error?.message || error);
    } finally {
      retryInProgress = false;
    }
  }
    // retry failed deployment every minute
  setInterval(runRetryCycle, 1 * 60 * 1000);
  processDeployment();
})();