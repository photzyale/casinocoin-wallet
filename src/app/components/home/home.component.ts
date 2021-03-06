import { Component, OnInit, OnDestroy, trigger, state, animate, 
         transition, style, ViewChild, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { Observable, BehaviorSubject } from 'rxjs';
import { LocalStorage, SessionStorage, LocalStorageService, SessionStorageService } from 'ngx-store';
import { ElectronService } from '../../providers/electron.service';
import { LogService } from '../../providers/log.service';
import { Menu as ElectronMenu, MenuItem as ElectronMenuItem } from 'electron';
import { CasinocoinService } from '../../providers/casinocoin.service';
import { ServerDefinition } from '../../domain/websocket-types';
import { WalletService } from '../../providers/wallet.service';
import { MarketService } from '../../providers/market.service';
import { MenuItem as PrimeMenuItem, Message, ContextMenu } from 'primeng/primeng';
import { SelectItem, Dropdown } from 'primeng/primeng';
import { MatListModule, MatSidenavModule } from '@angular/material';
import { AppConstants } from '../../domain/app-constants';
import { CSCUtil } from '../../domain/csc-util';
import { CSCCrypto } from '../../domain/csc-crypto';
import { LedgerStreamMessages, ServerStateMessage } from '../../domain/websocket-types';
import { setTimeout } from 'timers';
import { Subject } from 'rxjs/Subject';
import { LokiKey } from '../../domain/lokijs';
import { WalletSettings } from 'app/domain/csc-types';
import * as LokiTypes from '../../domain/lokijs';
import Big from 'big.js';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  animations: [
    trigger('component_visibility', [
        state('shown', style({
            opacity: 1
        })),
        state('hidden', style({
            opacity: 0
        })),
        transition('* => *', animate('.75s'))
    ])
  ]
})

export class HomeComponent implements OnInit, OnDestroy, AfterViewInit {

  @SessionStorage() public currentWallet: string;

  @ViewChild('contextMenu') contextMenu: ContextMenu;
  @ViewChild('fiatCurrenciesDrowdown') fiatCurrenciesDrowdown: Dropdown;


  //show_menu: string = 'shown';
  show_menu: string = 'small';
  menu_items: PrimeMenuItem[];
  tools_context_menu: ElectronMenu;
  connection_context_menu: ElectronMenu;

  applicationVersion: string;
  dbMetadata: LokiTypes.LokiDBMetadata;

  showPrivateKeyImportDialog:boolean = false;
  showSettingsDialog:boolean = false;
  showServerInfoDialog:boolean = false;
  showPasswordDialog:boolean = false;
  showPasswordCallback;

  walletSettings: WalletSettings;
  fiatCurrencies: SelectItem[] = [];
  selectedFiatCurrency: string;
  privateKeySeed:string;
  walletPassword:string;
  importFileObject:Object;
  currentWalletObject:Object;

  privateKeyExportLocation: string = "";
  privateKeyImportfile: string = "";
  importKeys: Array<LokiKey> = [];

  // Growl messages
  msgs: Message[] = [];

  overview_image: string = require("./assets/overview_active.png");
  overview_text_class: string = "active_text_color";
  send_image: string = require("./assets/send.png");
  send_text_class: string = "inactive_text_color";
  receive_image: string = require("./assets/receive.png");
  receive_text_class: string = "inactive_text_color";
  addressbook_image: string = require("./assets/addressbook.png");
  addressbook_text_class: string = "inactive_text_color";
  swap_image: string = require('./assets/swap.png');
  swap_text_class: string = "inactive_text_color";

  active_menu_item: string = "transactions";

  isConnected = new BehaviorSubject<boolean>(false);
  connected_icon: string = "fa fa-wifi fa-2x";
  connected_tooltip: string = "Connected";
  // connection_image: string = "assets/icons/connected-red.png";
  connectionColorClass: string = "connected-color";
  connectionImage: string = "assets/icons/connected.png";
  manualDisconnect: boolean = false;
  searchDate: Date;

  serverState: ServerStateMessage;
  currentServer: ServerDefinition;
  casinocoinConnectionSubject: Observable<any>;
  uiChangeSubject = new BehaviorSubject<string>(AppConstants.KEY_INIT);

  balance:string;;
  fiat_balance:string;
  transaction_count:number;
  last_transaction:number;

  footer_visible: boolean = false;
  error_message: string = "";

  backupPath: string;
  lastMenuEvent: string = "";
  navigationSucceeded: boolean = false;
  showProgress: boolean = false;

  constructor( private logger: LogService, 
               private router: Router,
               private electron: ElectronService,
               private walletService: WalletService,
               private casinocoinService: CasinocoinService ,
               private localStorageService: LocalStorageService,
               private sessionStorageService: SessionStorageService,
               private marketService: MarketService,
               private datePipe: DatePipe,
               private currencyPipe: CurrencyPipe ) {
    this.logger.debug("### INIT HOME ###");
    this.applicationVersion = this.electron.remote.app.getVersion();
    this.backupPath = this.electron.remote.getGlobal("vars").backupPath;
    this.logger.debug("### HOME Backup Path: " + this.backupPath);
    this.electron.ipcRenderer.on("action", (event, arg) => {
      if(arg === "save-wallet"){
        this.logger.debug("### HOME Logout Wallet on Suspend ###");
        this.closeWallet();
      } else if(arg === "quit-wallet"){
        this.logger.debug("### HOME Save Wallet on Quit ###");
        this.walletService.openWalletSubject.subscribe(state => {
          if (state == AppConstants.KEY_INIT){
            this.electron.ipcRenderer.send('wallet-closed', true);
          }
        });
        // backup wallet
        this.backupWallet();
        // close and logout
        this.walletService.closeWallet();
      }
    });
  }

  ngAfterViewInit(){
    this.logger.debug("### HOME ngAfterViewInit() ###");
    // We use setTimeout to avoid the `ExpressionChangedAfterItHasBeenCheckedError`
    // See: https://github.com/angular/angular/issues/6005
    setTimeout(_ => {}, 0);
    // subscribe to UI changes
    this.uiChangeSubject.subscribe(status =>{
      if(status == AppConstants.KEY_CONNECTED){
        this.setWalletUIConnected();
      } else if (status == AppConstants.KEY_DISCONNECTED){
        this.setWalletUIDisconnected();
      }
    });
  }

  ngOnInit() {
    this.logger.debug("### HOME ngOnInit() - currentWallet: " + this.currentWallet);
    // get the complete wallet object
    let availableWallets = this.localStorageService.get(AppConstants.KEY_AVAILABLE_WALLETS);
    let walletIndex = availableWallets.findIndex( item => item['walletUUID'] == this.currentWallet);
    this.currentWalletObject = availableWallets[walletIndex];
    // get server state
    let serverStateSubject = this.casinocoinService.serverStateSubject;
    serverStateSubject.subscribe( state => {
      this.serverState = state;
      this.logger.debug("### HOME Server State: " + JSON.stringify(this.serverState));
    });
    // define Tools context menu
    let tools_context_menu_template = [
      { label: 'Import Private Keys', 
        click(menuItem, browserWindow, event) {
          browserWindow.webContents.send('context-menu-event', 'import-priv-key');
        }
      },  
      { label: 'Export Private Keys', 
        click(menuItem, browserWindow, event) { 
          browserWindow.webContents.send('context-menu-event', 'export-priv-keys');
        }
      }
      // { label: 'Import Existing Wallet', 
      //   click(menuItem, browserWindow, event) { 
      //     browserWindow.webContents.send('context-menu-event', 'add-wallet');
      //   }
      // }
    ];
    this.tools_context_menu = this.electron.remote.Menu.buildFromTemplate(tools_context_menu_template);
    this.tools_context_menu.append(new this.electron.remote.MenuItem({ type: 'separator' }));
    this.tools_context_menu.append(new this.electron.remote.MenuItem(
      { label: 'Create New Wallet', 
        click(menuItem, browserWindow, event) { 
          browserWindow.webContents.send('context-menu-event', 'create-wallet');
        }, enabled: true
      })
    );
    this.tools_context_menu.append(new this.electron.remote.MenuItem({ type: 'separator' }));
    this.tools_context_menu.append(new this.electron.remote.MenuItem(
      { label: 'Close Wallet', 
        click(menuItem, browserWindow, event) { 
          browserWindow.webContents.send('context-menu-event', 'close-wallet');
        }, enabled: true
      })
    );
    this.tools_context_menu.append(new this.electron.remote.MenuItem({ type: 'separator' }));
    this.tools_context_menu.append(new this.electron.remote.MenuItem(
      { label: 'Quit', 
        click(menuItem, browserWindow, event) { 
          browserWindow.webContents.send('context-menu-event', 'quit');
        }
      })
    );

    // define Connection context menu
    let connect_context_menu_template = [
     { label: 'Connect to Network', 
       click(menuItem, browserWindow, event) { 
          browserWindow.webContents.send('connect-context-menu-event', 'connect'); }, visible: true
      },
      { label: 'Disconnect from Network', 
        click(menuItem, browserWindow, event) { 
            browserWindow.webContents.send('connect-context-menu-event', 'disconnect'); }, visible: false
      },
      { label: 'Server Information', 
        click(menuItem, browserWindow, event) { 
            browserWindow.webContents.send('connect-context-menu-event', 'server-info'); }, visible: false
      }
    ];
    this.connection_context_menu = this.electron.remote.Menu.buildFromTemplate(connect_context_menu_template);
    

    // listen to tools context menu events
    this.electron.ipcRenderer.on('context-menu-event', (event, arg) => {
      if(this.navigationSucceeded){
        this.logger.debug("### HOME Menu Event: " + arg);
        if(arg == 'import-priv-key')
          this.onPrivateKeyImport();
        else if(arg == 'export-priv-keys')
          this.onPrivateKeysExport();
        else if(arg == 'backup-wallet')
          this.onBackupWallet();
        else if(arg == 'restore-backup')
          this.onRestoreBackup();
        else if(arg == 'add-wallet')
          this.onAddWallet();
        else if(arg == 'create-wallet')
          this.createWallet();
        else if(arg == 'close-wallet')
          this.closeWallet();
        else if(arg == 'quit')
          this.onQuit();
        else
          this.logger.debug("### Context menu not implemented: " + arg);
      }
    });

    // listen to connect context menu events
    this.electron.ipcRenderer.on('connect-context-menu-event', (event, arg) => {
      if(this.navigationSucceeded){
        if(arg == 'connect'){
          if(this.lastMenuEvent != "connect"){
            this.lastMenuEvent = "connect";
            this.onConnect();
          }
        }
        else if(arg == 'disconnect'){
          if(this.lastMenuEvent != "disconnect"){
            this.lastMenuEvent = "disconnect";
            this.onDisconnect();
          }
        }
        else if(arg == 'server-info')
          this.onServerInfo();
      }
    });

    // navigate to the transactions
    this.router.navigate(['transactions']).then(navResult => {
      this.logger.debug("### HOME transactions navResult: " + navResult);
      if(navResult){
        this.navigationSucceeded = true;
        // connect to casinocoin network
        this.doConnectToCasinocoinNetwork();
      } else {
        this.navigationSucceeded = false;
      }
    });
    // subscribe to the openWallet subject
    let openWalletSubject = this.walletService.openWalletSubject;
    openWalletSubject.subscribe( result => {
      if(result == AppConstants.KEY_LOADED){
        this.logger.debug("### HOME Wallet Open ###");
        // get the DB Metadata
        this.dbMetadata = this.walletService.getDBMetadata();
        this.logger.debug("### HOME DB Metadata: " + JSON.stringify(this.dbMetadata));
        // check transaction index
        if(!this.walletService.isTransactionIndexValid()){
          this.logger.debug("### HOME Rebuild TX List from Online ###");
          this.walletService.clearTransactions();
        }
        // update balance
        this.doBalanceUpdate();
        // update transaction count
        this.doTransacionUpdate();
      } else if(result == AppConstants.KEY_INIT && this.currentWallet){
        // wallet is not open but we seem to have a session, not good so redirect to login
        this.sessionStorageService.remove(AppConstants.KEY_CURRENT_WALLET);
        this.router.navigate(['login']);
      }
    });
    this.setConnectedMenuItem(true);
    // load wallet settings
    this.walletSettings = this.localStorageService.get(AppConstants.KEY_WALLET_SETTINGS);
    if(this.walletSettings == null){
      // settings do not exist yet so create
      this.walletSettings = {fiatCurrency: "USD", showNotifications: true};
      this.localStorageService.set(AppConstants.KEY_WALLET_SETTINGS, this.walletSettings);
    }
    // load fiat currencies and update market value
    this.fiatCurrencies = this.marketService.getFiatCurrencies();
    this.updateMarketService(this.walletSettings.fiatCurrency);
  }

  ngOnDestroy(){
    this.logger.debug("### HOME ngOnDestroy() ###");
    if(this.isConnected && this.casinocoinService != undefined){
      this.casinocoinService.disconnect();
    }
  }

  doConnectToCasinocoinNetwork(){
    this.logger.debug("### HOME doConnectToCasinocoinNetwork() ###");
    // Connect to the casinocoin network
    this.casinocoinService.connect().subscribe(connected => {
      // this.casinocoinService.casinocoinConnectedSubject.subscribe( connected => {
        if(connected == AppConstants.KEY_CONNECTED){
          this.logger.debug("### HOME Connected ###");
          // subscribe to transaction updates
          this.casinocoinService.transactionSubject.subscribe( tx => {
            this.doTransacionUpdate();
          });
          // subscribe to account updates
          this.casinocoinService.accountSubject.subscribe( account => {
            this.doBalanceUpdate();
          });
          this.uiChangeSubject.next(AppConstants.KEY_CONNECTED);
        } else if(connected == AppConstants.KEY_DISCONNECTED){
          this.uiChangeSubject.next(AppConstants.KEY_DISCONNECTED);
        } else {
          this.logger.debug("### HOME Connected value: " + connected);
        }
        this.logger.debug("### HOME currentServer: " + JSON.stringify(this.currentServer));
      });
  }

  setWalletUIConnected(){
      this.logger.debug("### HOME Set GUI Connected ###");
      this.connectionImage = "assets/icons/connected.png"
      this.connectionColorClass = "connected-color";
      this.connected_tooltip = "Connected";
      this.setConnectedMenuItem(true);
      this.currentServer = this.casinocoinService.getCurrentServer();
  }

  setWalletUIDisconnected(){
      this.logger.debug("### HOME Set GUI Disconnected ###");
      this.connectionImage = "assets/icons/connected-red.png";
      this.connectionColorClass = "disconnected-color";
      this.connected_tooltip = "Disconnected";
      this.setConnectedMenuItem(false);
      // this.currentServer = { server_id: '', server_url: '', response_time: -1 };
  }

  onMenuClick() {
    this.logger.debug("Menu Clicked !!");
    this.show_menu = this.show_menu == 'small' ? 'wide' : 'small';
  }

  onSettingsMenuClick(event) {
    this.showSettingsDialog = true;
  }

  onToolsMenuClick(event) {
    this.tools_context_menu.popup(this.electron.remote.getCurrentWindow());
  }

  onConnectionClick(event) {
    this.connection_context_menu.popup(this.electron.remote.getCurrentWindow());
  }

  selectedMenuItem(item) {
    item.command();
  }

  onConnect(){
    this.logger.debug("### HOME Connect ###");
    this.manualDisconnect = false;
    this.casinocoinService.connect();
    // this.connectToCasinocoinNetwork();
  }

  onDisconnect(){
    this.logger.debug("### HOME Disconnect ###");
    this.manualDisconnect = true;
    this.casinocoinService.disconnect();
  }

  onServerInfo() {
    this.currentServer = this.casinocoinService.getCurrentServer();
    this.showServerInfoDialog = true;
  }

  onQuit() {
    this.logger.debug("Quit Clicked !!");
    // backup database
    // this.backupWallet();
    // close the Database!
    // this.walletService.closeWallet();
    // Close the windows to cause an application exit
    this.electron.remote.getGlobal("vars").exitFromRenderer = true;
    this.electron.remote.getCurrentWindow.call( close() );
  }

  executePasswordCallback(){
    this.showPasswordCallback();
  }

  initPasswordCheck(){
    this.walletPassword = "";
    this.error_message = "";
    this.footer_visible = false;
  }

  onPrivateKeyImport() {
    // this.showPrivateKeyImportDialog = true;
    this.logger.debug("### Open File Dialog: " + this.electron.remote.app.getPath("documents"));
    this.importKeys = [];
    let fileFilters = [{name: 'Private Keys', extensions: ['keys']} ];
    this.electron.remote.dialog.showOpenDialog(
        { title: 'Private Key Import',
          defaultPath: this.electron.remote.app.getPath("documents"),
          filters: fileFilters,
          properties: ['openFile']
        }, (files) => {
          this.logger.debug("### Files: " + JSON.stringify(files));
          if(files && files.length > 0){
            this.walletPassword = "";
            let keys:Array<LokiKey> = JSON.parse(fs.readFileSync(files[0]));
            this.logger.debug("### Keys: " + JSON.stringify(keys));
            keys.forEach( key => {
              // check if not yet exits
              let dbKey = this.walletService.getKey(key.accountID);
              if(dbKey == null){
                this.importKeys.push(key);
              }
            });
            if(this.importKeys.length > 0){
              this.logger.debug("### Show Import Key Dialog ###");
              this.showPrivateKeyImportDialog = true;
            } else {
              this.electron.remote.dialog.showMessageBox({ message: "There are no new keys to be imported from the selected file.", buttons: ["OK"] });
            }
          }
        }
    );
  }

  onPrivateKeysExport() {
    // show password dialog
    this.initPasswordCheck();
    this.showPasswordCallback = this.selectPrivateKeysExportLocation;
    this.showPasswordDialog = true;
  }

  onImportPrivateKey(){
    this.logger.debug("### Import Private Keys: " + this.importKeys);
    if(this.walletPassword.length == 0 ){
      this.error_message = "Please enter your password.";
      this.footer_visible = true;
    } else if(!this.walletService.checkWalletPasswordHash(this.walletPassword)){
      this.error_message = "You entered an invalid password.";
      this.footer_visible = true;
    } else {
      this.importKeys.forEach(importKey => {
        this.walletService.importPrivateKey(importKey.secret, this.walletPassword);
      });
      // refresh accounts
      this.casinocoinService.checkAllAccounts();
      this.showPrivateKeyImportDialog = false;
      this.importKeys = [];
      this.walletPassword = "";
      this.error_message = "";
      this.footer_visible = false;
    }
  }

  selectPrivateKeysExportLocation() {
    this.logger.debug("### selectPrivateKeysExportLocation()");
    // first check the password
    if(this.walletPassword.length == 0 ){
      this.error_message = "Please enter your password.";
      this.footer_visible = true;
    } else if(!this.walletService.checkWalletPasswordHash(this.walletPassword)){
      this.error_message = "You entered an invalid password.";
      this.footer_visible = true;
    } else {
      this.showPasswordDialog = false;
      this.logger.debug('Open File Dialog: ' + this.electron.remote.app.getPath("documents"));
      this.electron.remote.dialog.showOpenDialog(
          { title: 'Private Key Export Location',
            defaultPath: this.electron.remote.app.getPath("documents"), 
            properties: ['openDirectory']}, (result) => {
            this.logger.debug('File Dialog Result: ' + JSON.stringify(result));
            if(result && result.length>0) {
              this.privateKeyExportLocation = result[0];
              // get all decrypted private keys
              let allPrivateKeys = this.walletService.decryptAllKeys(this.walletPassword);
              // create a filename
              let filename = this.datePipe.transform(Date.now(), "yyyy-MM-dd-HH-mm-ss-") + this.currentWallet + '.keys';
              let keyFilePath = path.join(result[0], filename);
              // Write the JSON array to the file 
              fs.writeFile(keyFilePath, JSON.stringify(allPrivateKeys), (err) => {
                if(err){
                  this.electron.remote.dialog.showErrorBox("Error saving private keys", "An error occurred writing your private keys to a file: " + err.message);
                }
                this.electron.remote.dialog.showMessageBox(
                  { message: "Your private keys have been saved to a file in the chosen directory. Make sure you put it in a safe place as it contains your decrypted private keys!", 
                    buttons: ["OK"] 
                  });
              });
            }
          }
      );
    }
  }

  onBackupWallet(){
    this.logger.debug('Open File Dialog: ' + this.electron.remote.app.getPath("documents"));
    this.electron.remote.dialog.showOpenDialog(
        { title: 'Wallet Backup Location',
          defaultPath: this.electron.remote.app.getPath("documents"), 
          properties: ['openDirectory','createDirectory']}, (result) => {
          this.logger.debug('File Dialog Result: ' + JSON.stringify(result));
          if(result && result.length>0) {
            let dbDump = this.walletService.getWalletDump();
            // create a filename
            let filename = this.datePipe.transform(Date.now(), "yyyy-MM-dd-HH-mm-ss") + "-"+ this.currentWallet + ".backup";
            let backupFilePath = path.join(result[0], filename);
            // Write the JSON array to the file 
            fs.writeFile(backupFilePath, dbDump, (err) => {
              if(err){
                  alert("An error occurred creating the backup file: "+ err.message)
              }
                          
              alert("The backup has been succesfully saved to: " + filename);
            });
          }
        }
    );
  }

  onRestoreBackup(){
    this.logger.debug('Open File Dialog: ' + this.electron.remote.app.getPath("documents"));
    this.electron.remote.dialog.showOpenDialog(
        { title: 'Select Wallet Backup File',
          defaultPath: this.electron.remote.app.getPath("documents"),
          filters: [
            { name: 'CSC Wallet Backups', extensions: ['backup'] }
          ],
          properties: ['openFile']
        }, (result) => {
          this.logger.debug('File Dialog Result: ' + JSON.stringify(result));
          if(result && result.length > 0) {
            let dbDump = fs.readFileSync(result[0]);
            if(dbDump.length > 0){
              this.walletService.importWalletDump(dbDump);
              // redirect to login
              this.router.navigate(['login']);
            }
          } else {
            alert("An error occurred reading the backup file: "+ result[0]);
          }
        }
    );
  }

  onAddWallet(){
    this.logger.debug('Open File Dialog: ' + this.electron.remote.app.getPath("documents"));
    this.electron.remote.dialog.showOpenDialog(
        { title: 'Select Wallet',
          defaultPath: this.electron.remote.app.getPath("documents"),
          filters: [
            { name: 'CSC Wallet', extensions: ['db'] }
          ],
          properties: ['openFile']
        }, (result) => {
          this.logger.debug('File Dialog Result: ' + JSON.stringify(result));
          if(result && result.length > 0) {
            this.importFileObject = path.parse(result[0]);
            this.walletPassword = "";
            this.showPasswordCallback = this.doWalletImport;
            this.showPasswordDialog = true;
            return;
          } else {
            return;
          }
        }
    );
  }

  updateMarketService(event){
    if (this.walletSettings.fiatCurrency !== undefined) {
        this.marketService.changeCurrency(this.walletSettings.fiatCurrency);
    }
  }


  doBalanceUpdate() {
    this.balance = this.walletService.getWalletBalance() ? this.walletService.getWalletBalance() : "0";
    let balanceCSC = new Big(CSCUtil.dropsToCsc(this.balance));
    this.logger.debug("### CSC Price: " + this.marketService.cscPrice + " BTC: " + this.marketService.btcPrice + " Fiat: " + this.marketService.coinMarketInfo.price_fiat);
    if(this.marketService.coinMarketInfo != null && this.marketService.coinMarketInfo.price_fiat !== undefined){
      let fiatValue = balanceCSC.times(new Big(this.marketService.coinMarketInfo.price_fiat)).toString();
      this.fiat_balance = this.currencyPipe.transform(fiatValue, this.marketService.coinMarketInfo.selected_fiat, true, "1.2-2");
    }
  }

  doTransacionUpdate(){
    this.transaction_count = this.walletService.getWalletTxCount() ? this.walletService.getWalletTxCount() : 0;
    let lastTX = this.walletService.getWalletLastTx();
    if(lastTX != null){
        this.last_transaction = lastTX.timestamp;
    }
  }

  doWalletImport(){
    this.logger.debug("Add Wallet Location: " + JSON.stringify(this.importFileObject));
    let walletHash = this.walletService.generateWalletPasswordHash(this.importFileObject['name'], this.walletPassword);
    let newWallet =
        { "walletUUID": this.importFileObject['name'], 
          "importedDate": CSCUtil.iso8601ToCasinocoinTime(new Date().toISOString()),
          "location": this.importFileObject['dir'],
          "hash": walletHash
        };
    let availableWallets = this.localStorageService.get(AppConstants.KEY_AVAILABLE_WALLETS);
    availableWallets.push(newWallet);
    this.localStorageService.set(AppConstants.KEY_AVAILABLE_WALLETS, availableWallets);
    // redirect to login
    this.sessionStorageService.remove(AppConstants.KEY_CURRENT_WALLET);
    this.router.navigate(['login']);
  }

  createWallet(){
    this.walletService.closeWallet();
    this.casinocoinService.disconnect();
    this.sessionStorageService.remove(AppConstants.KEY_CURRENT_WALLET);
    this.walletService.openWalletSubject.next(AppConstants.KEY_INIT);
    this.sessionStorageService.set(AppConstants.KEY_CREATE_WALLET_RUNNING, true);
    this.router.navigate(['wallet-setup']);
  }

  closeWallet(){
    this.walletService.closeWallet();
    this.casinocoinService.disconnect();
    this.sessionStorageService.remove(AppConstants.KEY_CURRENT_WALLET);
    this.router.navigate(['login']);
    // this.electron.remote.getCurrentWindow().reload();
  }

  setConnectedMenuItem(connected: boolean){
    if(connected){
      // enable disconnect
      this.connection_context_menu.items[0].visible = false;
      this.connection_context_menu.items[1].visible = true;
      this.connection_context_menu.items[2].visible = true;
    } else {
      // enable connect
      this.connection_context_menu.items[0].visible = true;
      this.connection_context_menu.items[1].visible = false;
      this.connection_context_menu.items[2].visible = false;
    }
  }

  // getConnectionColorClass(){
  //   if(this.isConnected.getValue()){
  //     return "connected-color";
  //   } else {
  //     return "disconnected-color"
  //   }
  // }

  // getConnectionImage(){
  //   if(this.isConnected.getValue()){
  //     return "../../../assets/icons/connected.png";
  //   } else {
  //     return "../../../assets/icons/connected-red.png"
  //   }
  // }

  onTransactions() {
    this.logger.debug("Transactions Clicked !!");
    this.active_menu_item = "transactions";
    // navigate to transactions
    this.router.navigate(['home','transactions']);
  }

  onSendCoins() {
    this.logger.debug("Send Coins Clicked !!");
    this.active_menu_item = "send";
    // navigate to send
    this.router.navigate(['home', 'send']);
  }

  onReceiveCoins() {
    this.logger.debug("Receive Coins Clicked !!");
    this.active_menu_item = "receive";
    // navigate to receive
    this.router.navigate(['home', 'receive']);
  }

  onAddressbook() {
    this.logger.debug("Addressbook Clicked !!");
    this.active_menu_item = "addressbook";
    // navigate to addressbook
    this.router.navigate(['home','addressbook']);
  }

  onCoinSwap() {
    this.logger.debug("Coin Swap Clicked !!");
    this.active_menu_item = "coinswap";
    // navigate to swap
    this.router.navigate(['home','swap']);
  }

  onSupport() {
    this.logger.debug("Support Clicked !!");
    this.active_menu_item = "support";
    // navigate to support
    this.router.navigate(['home','support']);
  }

  onSettingsSave(){
    // save the settings to localstorage
    this.localStorageService.set(AppConstants.KEY_WALLET_SETTINGS, this.walletSettings);
    // update the balance to reflect the last changes
    this.doBalanceUpdate();
    this.showSettingsDialog = false;
  }

  backupWallet() {
    this.logger.debug("### HOME Backup DB ###");
    let dbDump = this.walletService.getWalletDump();
    // create a filename
    let filename = this.datePipe.transform(Date.now(), "yyyy-MM-dd-HH-mm-ss") + "-csc-wallet.backup";
    let backupFilePath = path.join(this.backupPath, filename);
    // Write the JSON array to the file 
    fs.writeFileSync(backupFilePath, dbDump);
    // signal electron we are done
    // this.electron.ipcRenderer.sendSync("backup-finished");
  }

}
