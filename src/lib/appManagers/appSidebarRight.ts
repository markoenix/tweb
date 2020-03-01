import { horizontalMenu, formatPhoneNumber, putPreloader } from "../../components/misc";
import Scrollable from '../../components/scrollable';
import { $rootScope } from "../utils";
import appMessagesManager from "./appMessagesManager";
import appPhotosManager from "./appPhotosManager";
import appPeersManager from "./appPeersManager";
import appUsersManager from "./appUsersManager";
import appProfileManager from "./appProfileManager";
import { RichTextProcessor } from "../richtextprocessor";
import { logger } from "../polyfill";
import appImManager from "./appImManager";
import appMediaViewer from "./appMediaViewer";
import LazyLoadQueue from "../../components/lazyLoadQueue";
import { wrapDocument, wrapAudio } from "../../components/wrappers";

const testScroll = false;

class AppSidebarRight {
  public sidebarEl = document.querySelector('.profile-container') as HTMLDivElement;
  public profileContentEl = document.querySelector('.profile-content') as HTMLDivElement;
  public profileElements = {
    avatar: this.profileContentEl.querySelector('.profile-avatar') as HTMLDivElement,
    name: this.profileContentEl.querySelector('.profile-name') as HTMLDivElement,
    subtitle: this.profileContentEl.querySelector('.profile-subtitle') as HTMLDivElement,
    bio: this.profileContentEl.querySelector('.profile-row-bio') as HTMLDivElement,
    username: this.profileContentEl.querySelector('.profile-row-username') as HTMLDivElement,
    phone: this.profileContentEl.querySelector('.profile-row-phone') as HTMLDivElement,
    notificationsRow: this.profileContentEl.querySelector('.profile-row-notifications') as HTMLDivElement,
    notificationsCheckbox: this.profileContentEl.querySelector('#profile-notifications') as HTMLInputElement,
    notificationsStatus: this.profileContentEl.querySelector('.profile-row-notifications > p') as HTMLParagraphElement
  };
  public sharedMedia: {
    [type: string]: HTMLDivElement
  } = {
    contentMembers: this.profileContentEl.querySelector('#content-members') as HTMLDivElement,
    contentMedia: this.profileContentEl.querySelector('#content-media') as HTMLDivElement,
    contentDocuments: this.profileContentEl.querySelector('#content-docs') as HTMLDivElement,
    contentLinks: this.profileContentEl.querySelector('#content-links') as HTMLDivElement,
    contentAudio: this.profileContentEl.querySelector('#content-audio') as HTMLDivElement,
  };
  
  public lastSharedMediaDiv: HTMLDivElement = null;
  
  private loadSidebarMediaPromises: {
    [type: string]: Promise<void>
  } = {};
  
  public sharedMediaTypes = [
    'inputMessagesFilterContacts', 
    'inputMessagesFilterPhotoVideo', 
    'inputMessagesFilterDocument', 
    'inputMessagesFilterUrl', 
    'inputMessagesFilterVoice'
  ];
  public sharedMediaType: string = '';
  private sharedMediaSelected: HTMLDivElement = null;
  
  private lazyLoadQueueSidebar = new LazyLoadQueue(5);
  /* public minMediaID: {
    [type: string]: number
  } = {}; */
  public cleared: {
    [type: string]: boolean
  } = {};
  
  public historiesStorage: {
    [peerID: number]: {
      [type: string]: number[]
    }
  } = {};
  
  private log = logger('SR');
  
  private peerID = 0;
  
  public sidebarScroll: Scrollable = null;
  private savedVirtualStates: {
    [id: number]: {
      hiddenElements: any,
      paddings: any
    }
  } = {};
  
  private profileTabs: HTMLUListElement;
  private prevTabID = -1;
  
  private mediaDivsByIDs: {
    [mid: number]: HTMLDivElement
  } = {};
  
  constructor() {
    let container = this.profileContentEl.querySelector('.profile-tabs-content') as HTMLDivElement;
    this.profileTabs = this.profileContentEl.querySelector('.profile-tabs') as HTMLUListElement;
    
    this.sidebarScroll = new Scrollable(this.sidebarEl, false, true, 500, 'SR');
    this.sidebarScroll.container.addEventListener('scroll', this.onSidebarScroll.bind(this));
    this.sidebarScroll.onScrolledBottom = () => {
      if(this.sharedMediaSelected && !this.sidebarScroll.hiddenElements.down.length 
        && this.sharedMediaSelected.childElementCount/* && false */) {
        this.loadSidebarMedia(true);
      }
    };
    
    horizontalMenu(this.profileTabs, container, (id, tabContent) => {
      if(this.prevTabID == id) return;
      
      this.sharedMediaType = this.sharedMediaTypes[id];
      this.sharedMediaSelected = tabContent.firstElementChild as HTMLDivElement;

      if(this.prevTabID != -1 && !this.sharedMediaSelected.childElementCount) { // quick brown fix
        this.loadSidebarMedia(true);
      }
      
      if(this.prevTabID != -1) {
        this.savedVirtualStates[this.prevTabID] = {
          hiddenElements: {
            up: this.sidebarScroll.hiddenElements.up.slice(),
            down: this.sidebarScroll.hiddenElements.down.slice(),
          },
          paddings: {
            up: this.sidebarScroll.paddings.up,
            down: this.sidebarScroll.paddings.down
          } 
        };
      }
      
      this.prevTabID = id;
      
      this.log('setVirtualContainer', id, this.sharedMediaSelected);
      this.sidebarScroll.setVirtualContainer(this.sharedMediaSelected);
      
      if(this.savedVirtualStates[id]) {
        this.log(this.savedVirtualStates[id]);
        this.sidebarScroll.hiddenElements = this.savedVirtualStates[id].hiddenElements;
        this.sidebarScroll.paddings = this.savedVirtualStates[id].paddings;
      }
    }, this.onSidebarScroll.bind(this));
    
    let sidebarCloseBtn = this.sidebarEl.querySelector('.sidebar-close-button') as HTMLButtonElement;
    sidebarCloseBtn.addEventListener('click', () => {
      this.toggleSidebar(false);
    });
    
    this.sharedMedia.contentMedia.addEventListener('click', (e) => {
      let target = e.target as HTMLDivElement;
      
      let messageID = +target.getAttribute('message-id');
      if(!messageID) {
        this.log.warn('no messageID by click on target:', target);
        return;
      }
      
      let message = appMessagesManager.getMessage(messageID);
      
      let ids = Object.keys(this.mediaDivsByIDs).map(k => +k).sort();
      let idx = ids.findIndex(i => i == messageID);
      
      let prev = ids[idx + 1] || null;
      let next = ids[idx - 1] || null;
      
      appMediaViewer.openMedia(message, target, this.mediaDivsByIDs[prev] || null, this.mediaDivsByIDs[next] || null);
    });
    
    this.profileElements.notificationsCheckbox.addEventListener('change', () => {
      //let checked = this.profileElements.notificationsCheckbox.checked;
      appImManager.mutePeer();
    });
    
    window.addEventListener('resize', () => {
      setTimeout(() => {
        this.sidebarScroll.onScroll();
        this.onSidebarScroll();
      }, 0);
    });
    
    if(testScroll) {
      let div = document.createElement('div');
      for(let i = 0; i < 500; ++i) {
        //div.insertAdjacentHTML('beforeend', `<div message-id="0" style="background-image: url(assets/img/camomile.jpg);"></div>`);
        div.insertAdjacentHTML('beforeend', `<div data-id="${i / 3 | 0}">${i / 3 | 0}</div>`);
        
        if((i + 1) % 3 == 0) {
          this.sharedMedia.contentMedia.append(div);
          div = document.createElement('div');
        }
        
        div.dataset.id = '' + (i / 3 | 0);
      }
      this.sharedMedia.contentMedia.append(div);
      (this.profileTabs.children[1] as HTMLLIElement).click(); // set media
    }
  }
  
  public onSidebarScroll() {
    this.lazyLoadQueueSidebar.check();
  }
  
  public toggleSidebar(enable?: boolean) {
    /////this.log('sidebarEl', this.sidebarEl, enable, isElementInViewport(this.sidebarEl));
    
    if(enable !== undefined) {
      if(enable) this.sidebarEl.classList.add('active');
      else this.sidebarEl.classList.remove('active');
      return;
    }
    
    if(this.sidebarEl.classList.contains('active')) {
      this.sidebarEl.classList.remove('active');
    } else {
      this.sidebarEl.classList.add('active');
    }
  }
  
  public loadSidebarMedia(single = false) {
    if(testScroll /* || 1 == 1 */) {
      return;
    }

    //this.log('loadSidebarMedia', single, this.peerID);
    
    let peerID = this.peerID;
    
    let typesToLoad = single ? [this.sharedMediaType] : this.sharedMediaTypes;
    
    if(!this.historiesStorage[peerID]) this.historiesStorage[peerID] = {};
    let historyStorage = this.historiesStorage[peerID];
    
    let promises = typesToLoad.map(type => {
      if(this.loadSidebarMediaPromises[type]) return this.loadSidebarMediaPromises[type];
      
      if(!historyStorage[type]) historyStorage[type] = [];
      let history = historyStorage[type];
      
      // заливать новую картинку сюда только после полной отправки!
      //let maxID = this.minMediaID[type] || 0;
      let maxID = history[history.length - 1] || 0;
      
      let ids = !maxID && appMessagesManager.historiesStorage[peerID] 
      ? appMessagesManager.historiesStorage[peerID].history.slice() : [];
      
      maxID = !maxID && ids.length ? ids[ids.length - 1] : maxID;
      //this.log('search house of glass pre', type, ids, maxID);
      
      return this.loadSidebarMediaPromises[type] = appMessagesManager.getSearch(peerID, '', {_: type}, maxID, history.length ? 50 : 15)
      .then(value => {
        ids = ids.concat(value.history);
        history.push(...ids);
        
        //this.log('search house of glass', type, value, ids, this.cleared);
        
        if($rootScope.selectedPeerID != peerID) {
          this.log.warn('peer changed');
          return;
        }
        
        if(this.cleared[type]) {
          ids = history;
          delete this.cleared[type];
        }
        
        let sharedMediaDiv: HTMLDivElement;
        let messages: any[] = [];
        for(let mid of ids) {
          let message = appMessagesManager.getMessage(mid);
          if(message.media) messages.push(message);
        }
        
        /*'inputMessagesFilterContacts', 
        'inputMessagesFilterPhotoVideo', 
        'inputMessagesFilterDocument', 
        'inputMessagesFilterUrl', 
        'inputMessagesFilterVoice'*/
        switch(type) {
          case 'inputMessagesFilterPhotoVideo': {
            sharedMediaDiv = this.sharedMedia.contentMedia;

            for(let message of messages) {
              let media = message.media.photo || message.media.document || (message.media.webpage && message.media.webpage.document);
              if(!media) {
                //this.log('no media!', message);
                continue;;
              }
              
              if(media._ == 'document' && media.type != 'video'/*  && media.type != 'gif' */) {
                //this.log('broken video', media);
                continue;
              }
              
              let div = document.createElement('div');
              //console.log(message, photo);
              
              let sizes = media.sizes || media.thumbs;
              if(sizes && sizes[0].bytes) {
                appPhotosManager.setAttachmentPreview(sizes[0].bytes, div, false, true);
              } /* else {
                this.log('no stripped size', message, media);
              } */
              
              //this.log('inputMessagesFilterPhotoVideo', message, media);
              
              let load = () => appPhotosManager.preloadPhoto(media, appPhotosManager.choosePhotoSize(media, 380, 0))
              .then((blob) => {
                if($rootScope.selectedPeerID != peerID) {
                  this.log.warn('peer changed');
                  return;
                }
                
                div.style.backgroundImage = 'url(' + URL.createObjectURL(blob) + ')';
              });
              
              div.setAttribute('message-id', '' + message.mid);
              
              this.lazyLoadQueueSidebar.push({div, load});
              
              this.lastSharedMediaDiv.append(div);
              if(this.lastSharedMediaDiv.childElementCount == 3) {
                this.sidebarScroll.append(this.lastSharedMediaDiv);
                this.lastSharedMediaDiv = document.createElement('div');
              }
              
              this.mediaDivsByIDs[message.mid] = div;
              
              //sharedMediaDiv.append(div);
            }
            
            break;
          }
          
          case 'inputMessagesFilterDocument': {
            sharedMediaDiv = this.sharedMedia.contentDocuments;

            for(let message of messages) {
              if(!message.media.document || message.media.document.type == 'voice') {
                continue;
              }
              
              let doc = message.media.document;
              if(doc.attributes) {
                if(doc.attributes.find((a: any) => a._ == "documentAttributeSticker")) {
                  continue;
                }
              }
              
              //this.log('come back down to my knees', message);
              
              let div = wrapDocument(message.media.document, true);
              this.sidebarScroll.append(div);
            }
            break;
          }
          
          case 'inputMessagesFilterUrl': {
            sharedMediaDiv = this.sharedMedia.contentLinks;

            for(let message of messages) {
              if(!message.media.webpage || message.media.webpage._ == 'webPageEmpty') {
                continue;
              }
              
              let webpage = message.media.webpage;
              let div = document.createElement('div');
              
              let previewDiv = document.createElement('div');
              previewDiv.classList.add('preview');
              
              //this.log('wrapping webpage', webpage);
              
              if(webpage.photo) {
                let load = () => appPhotosManager.preloadPhoto(webpage.photo.id, appPhotosManager.choosePhotoSize(webpage.photo, 380, 0))
                .then((blob) => {
                  if($rootScope.selectedPeerID != peerID) {
                    this.log.warn('peer changed');
                    return;
                  }
                  
                  previewDiv.style.backgroundImage = 'url(' + URL.createObjectURL(blob) + ')';
                });
                
                this.lazyLoadQueueSidebar.push({div: previewDiv, load});
              } else {
                previewDiv.innerText = (webpage.title || webpage.description || webpage.url || webpage.display_url).slice(0, 1);
                previewDiv.classList.add('empty');
              }
              
              let title = webpage.rTitle || '';
              let subtitle = webpage.rDescription || '';
              let url = RichTextProcessor.wrapRichText(webpage.url || '');
              
              if(!title) {
                //title = new URL(webpage.url).hostname;
                title = webpage.display_url.split('/', 1)[0];
              }
              
              div.append(previewDiv);
              div.insertAdjacentHTML('beforeend', `
              <div class="title">${title}</div>
              <div class="subtitle">${subtitle}</div>
              <div class="url">${url}</div>
              `);
              
              if(div.innerText.trim().length) {
                this.sidebarScroll.append(div);
              }
              
            }
            
            break;
          }
          
          /* case 'inputMessagesFilterVoice': {
            //this.log('wrapping audio', message.media);
            if(!message.media || !message.media.document || message.media.document.type != 'voice') {
              break;
            }
            
            let doc = message.media.document;
            
            this.log('wrapping audio', doc);
            
            let audioDiv = wrapAudio(doc);
            
            this.sharedMedia.contentAudio.append(audioDiv);
            
            break;
          } */
          
          default:
          //console.warn('death is my friend', message);
          break;
        }

        if(sharedMediaDiv) {
          let parent = sharedMediaDiv.parentElement;
          if(parent.lastElementChild.classList.contains('preloader')) {
            parent.lastElementChild.remove();
          }
        }
        
        this.onSidebarScroll();
      }).then(() => {
        this.loadSidebarMediaPromises[type] = null;
      }, (err) => {
        this.log.error('load error:', err);
        this.loadSidebarMediaPromises[type] = null;
      });
    });
    
    return promises;
  }
  
  public fillProfileElements() {
    let peerID = this.peerID = $rootScope.selectedPeerID;
    this.loadSidebarMediaPromises = {};
    this.lastSharedMediaDiv = document.createElement('div');
    
    //this.log('fillProfileElements');
    
    this.profileContentEl.parentElement.scrollTop = 0;
    this.profileElements.bio.style.display = 'none';
    this.profileElements.phone.style.display = 'none';
    this.profileElements.username.style.display = 'none';
    this.profileElements.notificationsRow.style.display = '';
    this.profileElements.notificationsCheckbox.checked = true;
    this.profileElements.notificationsStatus.innerText = 'Enabled';
    
    this.mediaDivsByIDs = {};
    
    this.lazyLoadQueueSidebar.clear();
    
    Object.keys(this.sharedMedia).forEach(key => {
      this.sharedMedia[key].innerHTML = '';
      
      let parent = this.sharedMedia[key].parentElement;
      if(!parent.querySelector('.preloader')) {
        putPreloader(parent, true);
      }
    });
    
    this.sharedMediaTypes.forEach(type => {
      //this.minMediaID[type] = 0;
      this.cleared[type] = true;
    });
    
    this.savedVirtualStates = {};
    this.prevTabID = -1;
    this.sidebarScroll.setVirtualContainer(null);
    (this.profileTabs.children[1] as HTMLLIElement).click(); // set media
    
    let setText = (text: string, el: HTMLDivElement) => {
      el.style.display = '';
      if(el.childElementCount > 1) {
        el.firstElementChild.remove();
      }
      
      let p = document.createElement('p');
      p.innerHTML = text;
      el.prepend(p);
    };
    
    // username
    if(peerID != appImManager.myID) {
      let username = appPeersManager.getPeerUsername(peerID);
      if(username) {
        setText(appPeersManager.getPeerUsername(peerID), this.profileElements.username);
      }
      
      let dialog: any = appMessagesManager.getDialogByPeerID(peerID);
      if(dialog.length) {
        dialog = dialog[0];
        let muted = false;
        if(dialog.notify_settings && dialog.notify_settings.mute_until) {
          muted = new Date(dialog.notify_settings.mute_until * 1000) > new Date();
        }
        
        appImManager.setMutedState(muted);
      }
    } else {
      this.profileElements.notificationsRow.style.display = 'none';
    }
    
    if(peerID > 0) {
      let user = appUsersManager.getUser(peerID);
      if(user.phone && peerID != appImManager.myID) {
        setText('+' + formatPhoneNumber(user.phone).formatted, this.profileElements.phone);
      }
      
      appProfileManager.getProfile(peerID, true).then(userFull => {
        if(this.peerID != peerID) {
          this.log.warn('peer changed');
          return;
        }
        
        if(userFull.rAbout && peerID != appImManager.myID) {
          setText(userFull.rAbout, this.profileElements.bio);
        }
        
        //this.log('userFull', userFull);
        
        if(userFull.pinned_msg_id) { // request pinned message
          appImManager.pinnedMsgID = userFull.pinned_msg_id;
          appMessagesManager.wrapSingleMessage(userFull.pinned_msg_id);
        }
        
        this.sidebarScroll.getScrollTopOffset();
      });
    } else {
      let chat = appPeersManager.getPeer(peerID);
      
      appProfileManager.getChatFull(chat.id).then((chatFull: any) => {
        if(this.peerID != peerID) {
          this.log.warn('peer changed');
          return;
        }
        
        //this.log('chatInfo res 2:', chatFull);
        
        if(chatFull.about) {
          setText(RichTextProcessor.wrapRichText(chatFull.about), this.profileElements.bio);
        }
        
        this.sidebarScroll.getScrollTopOffset();
      });
    }
    
    this.sidebarScroll.getScrollTopOffset();
    //this.loadSidebarMedia();
  }
}

export default new AppSidebarRight();
