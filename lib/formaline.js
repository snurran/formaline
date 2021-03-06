/*!
 * formaline
 * Copyright(c) 2011 Guglielmo Ferri <44gatti@gmail.com>
 * MIT Licensed
 */

/**
 * Library version 0.5.7
 */

exports.version = '0.5.7';

var fs = require( 'fs' ),
    crypto = require( 'crypto' ),
    emitter = require( 'events' ).EventEmitter,
    querystring = require( 'querystring' ),
    path = require( 'path' ),
    ext = require( './extensions' ),
    parser  = require( './quickSearch' );

var setDebuggingLevel = function( dstring, form ){
    var p = '', 
        dlevels = querystring.parse( "debug:off,1:on,2:on,3:off,file:off,console:on,record:off", ',', ':' ), // debug:'on' print always : 0 level ( errors )
        flog = null,
        rlog = null,
        fpath = null,
        rpath = null,
        filelogging = false,
        recordRequest = false;
        
    if( dstring ){
        try{
          p = querystring.parse( dstring, ',', ':' );
          dlevels = p;
          filelogging = ( dlevels[ 'file' ] === 'on' );
          recordRequest = ( dlevels[ 'record' ] === 'on' );
        }catch( err ){
            console.log( 'formaline.setDebuggingLevel(): config string parse error ->', err.message );
        }
    }
    if( filelogging || recordRequest ){
        
        form.on( 'startlogging', ( function( req ){
            var fname = path.basename( form.uploadRootDir ).replace( '/', '' ),
                ok = ( dlevels[ 3 ] === 'on' ) && ( dlevels.debug === 'on' );
            if( filelogging ){
                fpath = form.uploadRootDir + form.startTime + '.' + fname +'.log';
                flog = new fs.WriteStream( fpath );
                if( ok ){
                    console.log( '\nformaline, captured \'startlogging\': new log file created ->', fpath, '\n');
                }
            }
            if( recordRequest ){
                rpath = form.uploadRootDir + form.startTime + '.' + fname +'.req';
                rlog = new fs.WriteStream( rpath );
                form.req.on( 'data', function( chunk ){
                    rlog.write( chunk );
                } );
                if( ok ){
                    console.log( '\nformaline, captured \'startlogging\': new record file created ->', rpath, '\n');
                }
            }
        } ).bind( this ) );
        
        
        form.on( 'stoplogging', ( function( req ){
            if( filelogging ){
                if( flog ){ flog.end(); }
                if( dlevels[ 3 ] === 'on' ){
                    console.log( '\nformaline, captured \'stoplogging\': the log data stream to file was closed ->', fpath, '\n' );
                }
                flog = null;
                fpath = null;
            }
            if( recordRequest ){
                if( rlog ){ rlog.end(); }
                if( dlevels[ 3 ] === 'on' ){
                    console.log( '\nformaline, captured \'stoplogging\': the request data stream to file was closed ->', rpath, '\n' );
                }
                rpath = null;
                rlog = null;
            }
        } ).bind( this ) );
        
    }
    return function(){
        var args = Array.prototype.slice.call( arguments ), // convert to array
            level = args [ 0 ];
        if( dlevels.debug === 'off' ){ return; }
        if( typeof level === 'number' ){
            if( ( level === 0 ) || ( dlevels[ level ] === 'on' )){
                if( filelogging && flog ) {
                    args.slice( 1, args.length ).forEach( function( v, i, a ){ 
                        if( typeof v === 'object' ){
                            flog.write( JSON.stringify( v ) );    
                        }else{
                            flog.write( v ); 
                        }  
                        if( i === a.length-1 ){ 
                            flog.write('\n'); 
                        } 
                    } );
                }
                if( dlevels[ 'console' ] === 'on' ) {
                    return console.log.apply( this, args.slice( 1, args.length ) );
                }
            }
        }else{
            if( dlevels[ 'console' ] === 'on' ) {
                return console.log.apply( this, args );
            }
        }
    };
};


var formaline = function ( config ){
    emitter.call( this, [] );
    
    //config default params
    this.uploadRootDir = '/tmp/';
    this.emitProgress = false;
    this.uploadThreshold = 1024 * 1024 * 1024; // bytes
    this.maxFileSize = 1024 * 1024 * 1024; 
    this.checkContentLength = false;
    this.removeIncompleteFiles = false;
    this.holdFilesExtensions = false;
    this.serialzedFieldThreshold = 1024 * 1024 * 1024;
    this.sha1sum = true;
    this.listeners = {};
    this.logging = 'debug:off,1:on,2:on,3:off,file:off,console:on,record:off';
    this.getSessionID = null; // not undefined!! apply function doesn't work on undefined values
    this.requestTimeOut = 120000; // default for socket timeout
    this.resumeRequestOnError = true; 
     
    if( config && ( typeof config === 'object' )){
        var me = this;
        apply( this, config );
        ( function(){
            var e, l = me.listeners;
            for ( e in l ) {
                if ( typeof l[ e ] === 'function' ) {
                    me.on( e, l[ e ] );
                } // else{ me.on( p, emptyFn ); }
            }
        } )();
    }
    
    // moved here for don't accidentally overwrite them with apply() ->
    this.logger = setDebuggingLevel( this.logging, this ); 
    this.chunksReceived = 0;
    this.currentChunksReceived = 0; // only for checking last chunk for data progress
    this.bytesReceived = 0;
    this.endResults = null;
    this.fileStream = null;
    this.fileSize = 0;
    this.parserOverallTime = 0;
    this.req = null;
    this.boundString = '';
    this.boundBuffer = null;
    this.qsBuffer = '';
    this.chopped = false;
    this.bytesWrittenToDisk = 0;
    this.completedFiles = [];
    this.incompleteFiles = [];
    this.incompleteFilesCollection = { list: [], hash: {} };
    this.receivedFilesCollection = { list: [], hash: {} };
    this.receivedFieldsCollection = { list: [], hash: {} };
    this.maxSizeExceeded = false;
    this.startTime = 0;
    this.endTime = 0;
    this.req = null;
    this.res = null;
    this.sid = null;
    this.requestTimeOut = ( this.requestTimeOut <= 100 ) ? 100 : this.requestTimeOut; // normalize timeout value, minimum value is 100 millisecs
    this.choppedHeadersPrefix = null;
};


formaline.prototype.__proto__ = emitter.prototype;


fproto = formaline.prototype;


fproto.emitEvent = function( type, obj, logLevel ){
    var etype = ( type === 'aborted' ) ? type.replace( 'aborted', 'abort' ) : type.replace( 'exception', '' ); // transform error type string
    this.logger( logLevel, '\n formaline, event: "' + etype + '" --> \n' , obj );
    if( type.indexOf( 'exception' ) > - 1 ){
        // exception event
        obj.type = etype;
        this.emit( 'error', obj );
        if( obj.fatal === true ){
              if( this.req && this.resumeRequestOnError ){ 
                // on fatal exceptions resuming request and removing 'data' event listener 
                this.req.removeAllListeners( 'data' );
                this.req.resume(); // TODO
            }else{
                // TODO add current completed / incomplete files 
                this.emit( 'loadend', { stats: {}, incomplete: [], files: [] }, this.res, this.next );
            }
        }
    }else if( type === 'loadend' ){
          this.emit( 'stoplogging' ); // TODO add this to every 'loadevent', move 'startlogging' after 'loadstart'
          this.emit( 'loadend', obj, this.res, this.next );
    }else{
        this.emit( etype, obj );
        if( ( etype === 'abort' ) || ( etype === 'timeout' ) ){
            obj =  { stats: {}, incomplete: [], files: [] }; //TODO add current completed / incomplete files 
            this.logger( 2, '\n formaline, event: "' + 'loadend' + '" --> \n' , obj );
            this.emit( 'loadend', obj, this.res, this.next );
        }
    }
};


fproto.parse = function( req, res, next ){
    this.startTime = Date.now();
    this.req = req;
    this.res = res;    
    this.next = ( next && ( typeof next === 'function' ) ) ? next : emptyFn;
    
    this.req.socket.setTimeout( this.requestTimeOut );
  
    var hs = req.headers,
        bytes2Receive = 0,
        clength = hs[ 'content-length' ],
        ctype = hs[ 'content-type' ],
        isUpload =  ( ctype && ( ~ctype.indexOf( 'multipart/form-data' ) ) ) ? true : false ,
        isUrlEncoded = ( ctype && ( ~ctype.indexOf( 'urlencoded' ) ) ) ? true : false ,
        jsonFatalErr = { isupload: isUpload, msg:'', fatal: true },
        jsonWarnErr = { type: 'warning', isupload: isUpload, msg:'' },
        
        /** INNER METHODS **/
        
        getProgressEmitter = ( function( headerContentLength ){
            var dProgress = this.emitProgress,
                bytesExpected = headerContentLength,
                ratio = ( bytesExpected && ( bytesExpected > 1 ) ) ? function( bytes ){ return ( bytes / bytesExpected ).toFixed( 8 ); } : dummyFn( -1 );
            if( dProgress === true ){
                return function( isEnd ){
                    this.emitEvent( 'progress', { bytes: this.bytesReceived, chunks: this.chunksReceived, ratio: ratio( this.bytesReceived) }, 3 );
                };
            }else if( typeof dProgress === 'number' ){
                dProgress = parseInt( dProgress, 10 );
                if( dProgress < 2 ){ dProgress = 2; }
                    return function( isEnd ) {
                        if( ( ( this.chunksReceived % dProgress ) === 1 ) || isEnd ){ // mod 1 is for first chunk
                           this.emitEvent( 'progress', { bytes: this.bytesReceived, chunks: this.chunksReceived, ratio: ratio( this.bytesReceived) }, 3 );
                        }
                    };
            }else{
                return emptyFn;
            }
        } ).bind( this ),
    
        validatePostSize = ( function( expected, isUpload ){
            var jsonPostWarn = { type: 'warning', isupload: true, msg: '' };
            this.logger( 1, '\nformaline, req.headers[ content-length ]: ' + expected + ' bytes' );
            if( expected > this.uploadThreshold ){ 
                if( this.checkContentLength === true ){
                    return false;
                }
                jsonPostWarn.msg = 'invalid content-length header, bytes to receive: ' + expected  + ', bytes allowed: ' + this.uploadThreshold;
                this.emitEvent( 'message', jsonPostWarn, 1 );
            }
            return true;
        } ).bind( this ),
        
        retrieveSessionIdentifier = ( function(){ 
            var jsonSessWarn = { type: 'warning', isupload: true, msg: '' };
            try{
                if( typeof this.getSessionID === 'function' ){
                    var sessionID = this.getSessionID( this.req );
                    if( typeof sessionID !== 'string' ){
                        jsonSessWarn.msg = 'unable to retrieve session identifier, function this.getSessionID( req ) does not return a String!' ;
                        this.emitEvent( 'message', jsonSessWarn, 1 );
                    }else{
                        //TODO security checks, escaping chars, sessionID string length?
                        this.logger( 2, '\nformaline, a session ID string was found: "' + sessionID + '"' );
                        return sessionID;
                    }
                }else{
                    jsonSessWarn.msg = 'unable to retrieve session identifier, configuration parameter this.getSessionID must be a function!' ;
                    this.emitEvent( 'message', jsonSessWarn, 1 );
                }  
              }catch( serr ){
                  jsonSessWarn.msg = 'unable to retrieve session identifier: ' + serr.stack ;      
                  return null;
              }
              return null; // sid doesn't exist
        } ).bind( this ),
        
        getUploadSubDirectoryName = ( function(){
            // is session id String exists returns it
            // otherwise returns a random number name
            return ( this.sid ) ? ( this.sid ) : ( parseInt( Date.now() * ( 1 + Math.random() ) * 10 * 32, 10 ) );
        } ).bind( this );
        
        /** END INNER METHODS **/
        
    if( ( req ) && ( typeof req === 'object' ) && ( req.body === undefined ) && ( req.method === 'POST' || req.method === 'PUT' )  && ( hs ) ){
    
        this.sid = retrieveSessionIdentifier(); 

        // TODO move dir checking and creation to async way
        if( path.existsSync( this.uploadRootDir ) ){
            this.logger( 3, '\nformaline, upload root dir exists: "' + this.uploadRootDir + '"' );
            this.uploadRootDir = this.uploadRootDir + getUploadSubDirectoryName() + '/'; 
        }else{ 
            // uploadRootDir doesn't exist
            if( this.uploadRootDir === '/tmp/' ){
                // exception
                jsonFatalErr.msg = 'default upload root directory: "'+ this.uploadRootDir + '" does not exist ! ';
                this.emitEvent( 'pathexception', jsonFatalErr, 0 );
                return;
            }else{ 
                // try default root directory '/tmp/'
                jsonWarnErr.msg = 'upload root directory specified: "' + this.uploadRootDir + '" does not exist ! ';
                this.emitEvent( 'message', jsonWarnErr, 1 );
                if( path.existsSync( '/tmp/' ) ){
                    jsonWarnErr.msg = 'switched to default root directory for uploads: "' + '/tmp/' + '"';
                    this.emitEvent( 'message', jsonWarnErr, 1 );
                    this.uploadRootDir = '/tmp/' + getUploadSubDirectoryName() + '/';
                }else{
                    // exception
                    jsonFatalErr.msg = 'default upload root directory: "'+ '/tmp/' + '" does not exist ! ';
                    this.emitEvent( 'pathexception', jsonFatalErr, 0 );
                    return;
                }
                
            }
        }
        
        if( !path.existsSync( this.uploadRootDir ) ){ // if subdirectory doesn't already exist, create it
             try{
                 fs.mkdirSync( this.uploadRootDir, '0750' );
             }catch( dirErr ){
                 jsonFatalErr.msg = 'directory creation exception: "' + this.uploadRootDir + '", ' + dirErr.message;
                 this.emitEvent( 'mkdirexception', jsonFatalErr, 0 );
                 return;
             }
        }else{
            // subdir already exists !
            this.logger( 3, '\nformaline, upload subdirectory already exists: "' + this.uploadRootDir + '"' );
        }
        this.emit( 'startlogging', req );
        this.progress = getProgressEmitter( clength );      
        
        if( isUpload ){ 
            try{
                this.boundString = ctype.match( /boundary=([^;]+)/mi )[ 1 ];
            }catch( berr ){ 
                // if boundary is not defined and type is multipart/form-data, 
                // it could be a custom, not standard compliant, XHR request
                jsonFatalErr.msg = 'req.headers[..]: the multipart/form-data request is not HTTP-compliant, boundary string wasn\'t found..';
                this.emitEvent( 'headersexception', jsonFatalErr, 0 );
                return;
            }
        }
        
        this.logger( 1, '\nformaline, parsing HTTP request headers..' );
        
        if( clength ){ 
            try{
                bytes2Receive = parseInt( clength, 10 );
            }catch(parseIntError){
               jsonFatalErr.msg = 'req.headers[ content-length ]: '+ parseIntError + ', length value:' + clength;
               this.emitEvent( 'headersexception', jsonFatalErr, 0 );
               return;
            }
            if( ! validatePostSize( bytes2Receive, isUpload ) ){
                jsonFatalErr.msg = 'req.headers[ content-length ] exceeds max allowable: ' + bytes2Receive + ' > ' + this.uploadThreshold;
                this.emitEvent( 'headersexception', jsonFatalErr, 0 );
                return;
            }
        }else{
            jsonFatalErr.msg =  'req.headers[ content-length ] not found: Parse Length Error';
            this.emitEvent( 'headersexception', jsonFatalErr, 0 );
            return;
        }
        if( ctype ){
            this.logger( 1, 'formaline, req.headers[ content-type ]: ' + ctype );
            if( isUpload ){
                // multipart form data
                this.boundBuffer = new Buffer( '--' + this.boundString );
                this.logger( 1, 'formaline, boundary : ' + this.boundBuffer + '\nformaline, boundary length: ' + this.boundBuffer.length + ' bytes' );
                this.req.addListener( 'close', this.closeConnection.createDelegate( this, true, true ) );
                this.req.addListener( 'data', this.parseMultipartData.bind( this ) );
                this.req.addListener( 'end', this.sendResponseToMultipart.bind( this, clength ) );
            }else if( isUrlEncoded ){ 
                // seralized fields
                this.req.addListener( 'close', this.closeConnection.createDelegate( this, false, true ) );
                this.req.addListener( 'data', this.parseUrlEncodedData.bind( this ) );
                this.req.addListener( 'end', this.sendResponseToUrlEncoded.bind( this, clength ) );
            }else{
                jsonFatalErr.msg = 'req.headers[ content-type ] --> ' + ctype + ' handler for this kind of request is not defined';
                this.emitEvent( 'headersexception', jsonFatalErr, 0 );
                return;
            }
        }else{
            jsonFatalErr.msg = 'req.headers[ content-type ] not found: Parse Type Error';
            this.emitEvent( 'headersexception', jsonFatalErr, 0 );
            return;
        }
    }else{
        jsonFatalErr.msg = 'req.headers[..] not found, or HTTP method not handled';
        this.emitEvent( 'headersexception', jsonFatalErr, 0 );
        return;
    }

}; // end parse


fproto.closeConnection = function( cerr, isUpload ){
    var jsonConnectionErr = { isupload: isUpload, msg: '', fatal: true },
        emsg = 'connection event: ' + '"' + cerr.code + '" : ' + cerr.message + ', max millisecs : ' + ( ( cerr.code === 'timeout' ) ? this.requestTimeOut : '' );
        emsg += ', error stack: ' + cerr.stack;
    jsonConnectionErr.msg = emsg;
    this.emitEvent( cerr.code , jsonConnectionErr, 0 );
};


fproto.parseUrlEncodedData = function( chunk ){
    this.bytesReceived += chunk.length;
    this.chunksReceived++;
    this.logger( 3, '\nformaline, ( serialized field ) data chunk was received! --> { ' );
    this.logger( 3, ' #: ' + this.chunksReceived + ',\n bytes: ' + chunk.length + ',\n bytes Received: \n', this.bytesReceived, '\n }' );
    if( this.bytesReceived <= this.serialzedFieldThreshold ){ 
        this.qsBuffer += chunk.toString( 'utf8' );
    }else{
      if( !this.maxSizeExceeded ){
          this.maxSizeExceeded = true;
          var jsonWarnIncomplete = { type: 'warning', isupload: true, msg:'' };
          jsonWarnIncomplete.msg = 'the max upload data threshold for serialzed fields was exceeded, bytes allowed: ' + this.serialzedFieldThreshold  +', received: ' + this.bytesReceived;
          this.emitEvent( 'message', jsonWarnIncomplete, 1 );
      }
    }
};


fproto.sendResponseToUrlEncoded = function(){
    this.endTime = Date.now();
    var fields = querystring.parse( this.qsBuffer, '&', '=' );
    if( this.qsBuffer && this.qsBuffer.length > 0 ){ 
        for( var f in fields ){
            var jsonFieldReceived = { name: f, value: ( typeof fields[ f ] === 'object' ) ? fields[ f ] : [ fields[ f ] ] };
            this.receivedFieldsCollection.list.push( jsonFieldReceived );
            this.emitEvent( 'load', jsonFieldReceived, 2 );
        }
    }
    this.endResults = {
        startTime: this.startTime,
        endTime: this.endTime,
        overallSecs: ( this.endTime - this.startTime ) / 1000,
        bytesReceived : this.bytesReceived,
        chunksReceived : this.chunksReceived,
        fieldsParsed:  this.receivedFieldsCollection.list.length
    };
    this.bytesReceived = this.chunksReceived = 0;
    this.maxSizeExceeded = false;
    this.emitEvent( 'loadend', { stats: this.endResults, incomplete: [], files: [], fields: this.receivedFieldsCollection.list }, 2 ); 
};
            

fproto.parseMultipartData = function( chunk ){
    this.req.pause();
    this.logger( 3, '\nformaline, data received, pausing request .. ' );
    
    var hchunk = null; // for chopped headers
    if ( this.choppedHeadersPrefix ){
        this.logger( 3, '\n chopped headers: '+ this.choppedHeadersPrefix );
        hchunk = new Buffer( chunk.length + this.choppedHeadersPrefix.length );
        this.choppedHeadersPrefix.copy( hchunk, 0, 0 );
        chunk.copy( hchunk, this.choppedHeadersPrefix.length, 0 );
        chunk = hchunk;
    }
    
    var bb = this.boundBuffer,
        bblength = bb.length,
        chunkLength = chunk.length,
        emsg = '',
        jsonMultiPartErr = { isupload: true, msg: '', fatal: true },
        escapeChars = /[\\\[\]\(\)\{\}\/\\\|\!\:\=\?\*\+\^\$\<\>\%\:\,\:\`\s\t\r\n]/g,
        fileDataChunk = null,
        stime =  Date.now(),
        results = parser.quickSearch( bb, chunk ),
        etime = Date.now(),
        resultsLength = results.length,
        wok = false,
        cok = false;       

    this.parserOverallTime += ( etime - stime );    
    this.bytesReceived += chunk.length;
    this.choppedHeadersPrefix = null; // TODO
    
    if( ++this.chunksReceived === 1 ){
        this.emitEvent( 'loadstart', { time: stime }, 2 );
    }
    
    this.progress();
    
    /** INNER METHODS**/
    
    var writeToFileStream = ( function( dataPayload, cfg ){  
            try{
                if( dataPayload ){
                    this.fileStream.write( dataPayload );
                    this.fileStream.mtime = new Date(); // Date.prototype.toISOString(); it is quite accurate when file data were received in only one chunk
                    this.logger( 3, '\nformaline, new data were written to this file stream  --> ', this.fileStream.path );
                    ( this.sha1sum ) ? this.fileStream.sha1sum.update( dataPayload ) : null;
                    this.fileSize += dataPayload.length;
                    this.bytesWrittenToDisk += dataPayload.length;
                }else{
                    if( cfg && cfg.path ){
                        this.fileStream = new fs.WriteStream( cfg.path ); 
                        this.fileSize = 0;                      
                        apply( this.fileStream, cfg, true );
                        fs.watchFile( cfg.path, ( function ( curr, prev ) {
                            if( this.fileStream ){
                               this.fileStream.mtime = curr.mtime;
                            }
                        } ).bind( this ) );
                        this.logger( 3, '\nformaline, a new file stream was created --> ', this.fileStream.path );
                    }else{
                        // TODO add cfg error for path
                    }
                }  
            }catch( fserr ){
                emsg = 'writing file stream : ' + this.fileStream + ', err: ' + fserr.message ;
                emsg +=  ', error stack: ' + fserr.stack;
                jsonMultiPartErr.msg = emsg;
                this.emitEvent( 'streamexception', jsonMultiPartErr, 0 ); 
                return false;
            }
            return true;
        } ).bind( this ),
    
        copyBuffer = ( function( sourceBuffer, targetBuffer, tStart, dStart, dEnd ){
            try{
                sourceBuffer.copy( targetBuffer, tStart, dStart, dEnd );
            }catch( berr ){
                emsg = 'copying buffer data file: ' + berr.message;
                emsg += '\nboundary length:' + bblength + '\nchunk length:' + sourceBuffer.length;
                emsg += '\nresult:' + result + '\n results length:' + resultsLength + '\n buffer start index:' + ( 0 ) + '\n buffer end index: ' + ( targetBuffer.length - 1 ) + '\n target buffer length: ' + targetBuffer.length;
                emsg +=  ', error stack: ' + berr.stack;
                jsonMultiPartErr.msg = emsg;
                this.emitEvent( 'bufferexception', jsonMultiPartErr, 0 );
                return false; 
            }
            return true;
        } ).bind( this ),
        
        addToIncompleteList = ( function( file ){
            var jsonWarnIncomplete = { type: 'warning', isupload: true, msg:'' };
            if( this.incompleteFiles.indexOf( file.path ) < 0 ){
                var jsonIncompleteFile = {
                    name: file.fieldname,
                    value: {
                        name: file.origname,
                        path: file.path,
                        type: file.ctype,
                        size: this.fileSize,
                        lastModifiedDate: file.mtime,
                        sha1checksum: null
                    }
                };
                this.incompleteFilesCollection[ path.basename( file.path ) ] = jsonIncompleteFile; 
                
                this.incompleteFiles.push( file.path );
                this.incompleteFilesCollection.list.push( jsonIncompleteFile );

                if( typeof this.incompleteFilesCollection.hash[ file.fieldname ] !== 'object' ){
                    this.incompleteFilesCollection.hash[ file.fieldname ] = [];
                }
                this.incompleteFilesCollection.hash[ file.fieldname ].push( jsonIncompleteFile.value );
                
                jsonWarnIncomplete.msg = 'the upload threshold or the max file size was exceeded, file incomplete: ' + path.basename( file.path ) ;
                this.emitEvent( 'message', jsonWarnIncomplete, 1 );
            }
        } ).bind( this ),
        
        addToCompletedList = ( function( file ){
            var filedatasha1sum = ( ( this.sha1sum ) ? file.sha1sum.digest( 'hex' ) : undefined ),
                jsonReceivedFile = {
                    name: file.fieldname,
                    value: { 
                        name: file.origname, 
                        path: file.path,
                        type: file.ctype, 
                        size: this.fileSize,
                        lastModifiedDate: file.mtime,
                        sha1checksum: ( filedatasha1sum ) ? filedatasha1sum : null                   
                    }
                };
            this.completedFiles.push( file.path );
            this.receivedFilesCollection.list.push( jsonReceivedFile );
            
            if( typeof this.receivedFilesCollection.hash[ file.fieldname ] !== 'object' ){
                this.receivedFilesCollection.hash[ file.fieldname ] = [];
            }
            this.receivedFilesCollection.hash[ file.fieldname ].push( jsonReceivedFile.value );
            
            this.emitEvent( 'load', jsonReceivedFile, 2 );
        } ).bind( this ),
        
        closeFileStream = ( function( fstream ){
            this.maxSizeExceeded = false;
            fstream.end();
            fs.unwatchFile( fstream.path );
            this.logger( 3, '\nformaline, this file stream was closed -->', fstream.path, '\n' );
        } ).bind( this ),
        
        resetFileStream = ( function(){
            this.fileStream = null;
        } ).bind( this ),
        
        generateHashFileName = ( function( fname ){
            return ( crypto.createHash( 'sha1' ).update( fname ).digest( 'hex' ) + ( ( this.holdFilesExtensions ) ? path.extname( fname ) : '' ) );
        } ).bind( this ),
        
        checkSize = ( function( buffer ){
            if( ( this.maxSizeExceeded ) || ( this.maxFileSize < this.fileSize + buffer.length ) ){
                if( !this.maxSizeExceeded ) {
                    this.maxSizeExceeded = true;
                }
                return false;
            }
            return true;
        } ).bind( this );

    
    /** END INNER METHODS**/


    this.logger( 3, '\nformaline, data chunk --> { ' );
    this.logger( 3, ' #: ' + this.chunksReceived + ',\n bytes: ' + chunk.length + ',\n parser results: \n', results, '\n }' );

    if( this.bytesReceived <= this.uploadThreshold ){ // is size allowed? 
        if( this.fileStream ){
            if( this.chopped ){ // fileStream exists, file data is chopped
                if( resultsLength === 0 ){ // chunk is only data payload
                    this.logger( 3, '  <-- this chunk contains only data.. bytes written to disk: ' + this.bytesWrittenToDisk );
                     if( checkSize( chunk ) ){
                        wok = writeToFileStream( chunk );
                        if ( !wok ){ 
                            // TODO
                            addToIncompleteList( this.fileStream );    
                            return; 
                        }
                    }
                }else{
                      
                    // chunk contains other boundaries, the first result.start value is the end ( - crlf ) of previous data chunk
                    this.logger( 3, '<-- this chunk contains data and fields.. current bytes written to disk: ' + this.bytesWrittenToDisk + '\n' );
                    fileDataChunk = new Buffer( results[ 0 ].start - 2 ); // last two chars are CRLF
                                        
                    if( !checkSize( fileDataChunk ) ){
                        addToIncompleteList( this.fileStream );
                    }else{
                        if( ( fileDataChunk.length > 0 ) && ( this.bytesWrittenToDisk + fileDataChunk.length < this.uploadThreshold ) ){
                            this.logger( 3, '<-- data part from the previous chopped file, bytes: ' + fileDataChunk.length + ', result[ 0 ] <> 0 :', results[ 0 ], '\n' );
                            cok = copyBuffer( chunk, fileDataChunk, 0, 0, results[ 0 ].start - 2 );
                            
                            wok = writeToFileStream( fileDataChunk );
                            if ( !wok || !cok ){ 
                                // TODO
                                addToIncompleteList( this.fileStream );    
                                return; 
                            }
                        }
                        addToCompletedList( this.fileStream );                
                    }                    
                    closeFileStream( this.fileStream );
                    resetFileStream( this.fileStream );
                }

            }else{
                closeFileStream( this.fileStream );
                addToIncompleteList( this.fileStream );
                resetFileStream( this.fileStream );
            }
        }else{
          // TODO fileStream error
        }
    }else{
        if( !this.maxSizeExceeded ){
            this.maxSizeExceeded = true;
            if( this.fileStream ){
                addToIncompleteList( this.fileStream );
            }
        }
    }
    this.logger( 3, '\n results length --> ' + resultsLength + ', chunk #: ' + this.chunksReceived + '\n' );
    for( var i = 0; i < resultsLength; i++ ){
        var result = results[ i ],
            rfinish = result.finish,
            rstart = result.start,
            heads = new Buffer( ( rfinish ) - ( rstart + bblength + 2 ) ), // only the headers
            headers = null,
            fieldName = null,
            hbsize = ( ( rfinish + 4 ) < ( chunk.length ) ? ( rfinish + 4 ) : ( chunk.length ) ),
            hbuffer = new Buffer( hbsize - rstart ),
            crlfcrlf = '\r\n\r\n',
            hok = false,
            endBoundary = '--' + this.boundString + '--',
            tbuff = null;
            
        this.logger( 3, '\n parsing headers, result #' + i, ': ', result, ', chunk #: ' + this.chunksReceived + '\n' );     
                                    
        if( rfinish > rstart + bblength + 2 ){
            cok = copyBuffer( chunk, heads, 0, rstart + bblength + 2,  ( rfinish > chunk.length - 1 ) ? ( chunk.length - 1 ) : rfinish ); 
            if ( !cok ){ 
                // TODO
                return; 
            }
        }else{
            this.logger( 3, ' seems that the end of request was reached, end payload index: ' + rfinish + ', start payload index: ' + ( rstart + bblength + 2 ) + '\n' );
        } 

        chunk.copy( hbuffer, 0, rstart, hbsize );
        hok = ( hbuffer.toString().match( crlfcrlf ) !== null );
        
        this.logger( 3, 'chunk #' + this.chunksReceived + ', cycle: ' + i + ', results[' + i + ']:', results[i], ' -> interval: ( ' + rfinish +', ' + chunk.length + ' ) \n crlfcrlf: ' + ( ( hok ) ? 'ok' : 'not found' ) );   
        this.logger( 3, 'headers -> *..* \n*' + hbuffer.toString() + '*\n' );
        
        if( !hok ){ // the last result contains chopped headers
            tbuff = new Buffer( chunk.length - rstart )
            chunk.copy( tbuff, 0, rstart );
            if ( tbuff.toString().indexOf( endBoundary ) === -1 ){
                // headers are chopped in two different chunks
                this.logger( 3, ' <-- no field name was found.. headers are chopped between two chunks: *' + tbuff.toString() + '*\n' );
                this.choppedHeadersPrefix = tbuff;
                continue;
            }else{
                this.logger( 3, ' <-- end of the request reached \n' );
                break;
            }
        }
        
        headers = heads.toString(); // TODO move heads here, minify code
        fieldName = headers.match( /name="([^\"]+)"/mi );
        
        if( fieldName ){ 
            var fileName = headers.match( /filename="([^\"]+)"/mi ),
                contentType  = headers.match( /Content-Type: ([^;]+)/mi ), // check space after header
                fieldCtype = ( contentType && contentType[ 1 ] ) ? contentType[ 1 ] : 'application/octet-stream',
                jsonWarnFileExists = { type: 'warning', isupload: true, msg: '' };
            this.logger( 3, ' fieldName parsed --> : ', fieldName[ 1 ], '\n' );
            if( fileName ){ // file field
                var escapedFilename = fileName[ 1 ].replace( escapeChars, '' ),
                    sha1filename = generateHashFileName( escapedFilename ),
                    filepath = this.uploadRootDir + sha1filename,
                    fileseed = '';
                
                this.logger( 3, ' fileName parsed --> : ', fileName[ 1 ], '\n' ); 
                
                if( ( this.completedFiles.indexOf( filepath ) > -1 )  || ( this.incompleteFiles.indexOf( filepath ) > -1 ) ){ 
                    fileseed = Date.now();
                    filepath = this.uploadRootDir + generateHashFileName( fileseed + '_' + escapedFilename );
                    jsonWarnFileExists.msg = 'this (sha1) file name already exists --> ' + sha1filename + ', ( filename: ' + escapedFilename + ', fieldname: ' + fieldName[ 1 ] + ' )';
                    this.emitEvent( 'message', jsonWarnFileExists, 1 );
                }
                // create new fileStream
                wok = writeToFileStream( null, {
                    path: filepath,
                    ctype: fieldCtype,
                    fieldname: fieldName[ 1 ],
                    origname: escapedFilename,
                    sha1sum: ( this.sha1sum ) ? crypto.createHash( 'sha1' ) : null,
                    mtime: '',
                    seed: fileseed
                });
                if ( !wok ){
                    // TODO
                    return; 
                }
                
                if( i === resultsLength - 1 ) { // last result
                    if( rfinish < chunkLength - 2 ){ // - "--", there is no boundary at the end of chunk, it is chopped data
                        this.logger( 3, '\n last data result -->', results[ i ], '<-- is chopped' );
                        this.chopped = true;
                        if( this.fileStream ){
                            if( this.bytesReceived <= this.uploadThreshold ){
                                if( chunkLength >= rfinish + 4 ){
                                    fileDataChunk = new Buffer( chunkLength - ( rfinish + 4  ) );
                                    if( !checkSize( fileDataChunk ) ){
                                        addToIncompleteList( this.fileStream );
                                    }else{                                        
                                        cok = copyBuffer( chunk, fileDataChunk, 0, rfinish + 4, chunkLength );                 
                                        wok = writeToFileStream( fileDataChunk );
                                        if ( !wok || !cok ){ 
                                            //TODO
                                            addToIncompleteList( this.fileStream );    
                                            return; 
                                        }
                                    }
                                }
                            }else{
                                addToIncompleteList( this.fileStream );
                            }
                            
                        }
                    }
                }else{
                    if( this.fileStream ){
                        fileDataChunk = new Buffer( results[ i + 1 ].start - 2 - ( results[ i ].finish + 4 ) ); // + 4 ( CRLFCRLF ) 
                        if( !checkSize( fileDataChunk) ){
                            addToIncompleteList( this.fileStream );
                        }else{ 
                        
                            if( this.bytesWrittenToDisk + fileDataChunk.length < this.uploadThreshold ){
                                cok = copyBuffer( chunk, fileDataChunk, 0, results[ i ].finish + 4 , results[ i + 1 ].start - 2 );
                                wok = writeToFileStream( fileDataChunk );
                                if ( !wok || !cok ){ 
                                    // TODO
                                    addToIncompleteList( this.fileStream );    
                                    return; 
                                }
                            }else{
                                addToIncompleteList( this.fileStream );
                            }

                            if( ( this.fileSize >= 0 ) && ( this.incompleteFiles.indexOf( this.fileStream.path ) < 0 ) ){
                                addToCompletedList( this.fileStream );
                            }
                        
                        }
                        
                        closeFileStream( this.fileStream );
                        resetFileStream();
                    }
                }
            }else{ // normal field
                if( i < resultsLength - 1 ){
                    fileDataChunk = new Buffer( results[ i + 1 ].start - 2   - ( results[ i ].finish + 4 ) ); // + 4 ( CRLFCRLF )
                    cok = copyBuffer( chunk, fileDataChunk, 0, results[ i ].finish + 4 , results[ i + 1 ].start - 2 );
                    if ( !cok ){ return; }
                    var jsonFieldReceived = { 
                        name: fieldName[ 1 ], 
                        value: fileDataChunk.toString() 
                    };
                    this.receivedFieldsCollection.list.push( jsonFieldReceived );
                    
                    if( typeof this.receivedFieldsCollection.hash[ fieldName[ 1 ] ] !== 'object' ){
                        this.receivedFieldsCollection.hash[ fieldName[ 1 ] ] = [];
                    }
                    this.receivedFieldsCollection.hash[ fieldName[ 1 ] ].push( jsonFieldReceived.value );

                    this.emitEvent( 'load', jsonFieldReceived, 2 );
                }
            }
        } // end if
    } // end for
    this.logger( 3, '\nformaline, resuming request .. ' );
    this.req.resume();
};


/* SEND RESPONSE */


fproto.sendResponseToMultipart =  function( nbytes ){ 
    this.endTime = Date.now();
    
    var logParserStats = ( function(){
            this.logger( 1, '\n (°)--/PARSER_STATS/ ' );
            this.logger( 1, '  |                          ' );
            this.logger( 1, '  |- overall parsing time    :', ( this.parserOverallTime / 1000 ).toFixed( 4 ), 'secs ' );            
            this.logger( 1, '  |- chunks received         :', this.chunksReceived ) ;
            this.logger( 1, '  |- average chunk rate      :', ( ( this.chunksReceived ) / ( this.parserOverallTime / 1000 ) ).toFixed( 1 ), 'chunk/sec' );
            this.logger( 1, '  |- average chunk size      :', ( ( this.bytesReceived / 1024 ) / this.chunksReceived ).toFixed( 3 ), 'KBytes' );            
            this.logger( 1, '  |- data parsed             :', ( this.bytesReceived / ( 1024 * 1024 ) ).toFixed( 4 ), 'MBytes' );
            this.logger( 1, '  |- average data rate       :', ( ( this.bytesReceived / ( 1024 * 1024 ) ) / ( this.parserOverallTime / 1000 )).toFixed( 1 ), 'MBytes/sec' );
            
        } ).bind( this ),
    
        logOverallResults = ( function( updateEndTime ){
            if( updateEndTime === true ){
                this.endTime = Date.now();
            }
            this.logger( 1, '\n (°)--/POST_OVERALL_RESULTS/ ');
            this.logger( 1, '  |                          ');
            this.logger( 1, '  |- overall time            :', ( ( this.endTime - this.startTime ) / 1000 ), 'secs' );
            this.logger( 1, '  |- bytes allowed           :', ( this.uploadThreshold / ( 1024 * 1024 ) ).toFixed( 6 ), 'MBytes');            
            this.logger( 1, '  |- data received           :', ( this.bytesReceived / ( 1024 * 1024 ) ).toFixed( 6 ), 'MBytes' );
            this.logger( 1, '  |- data written to disk    :', ( this.bytesWrittenToDisk  / ( 1024 * 1024 ) ).toFixed( 6 ), 'MBytes' );
            this.logger( 1, '  |- completed files         :', this.completedFiles.length );
            this.logger( 1, '  |- ' + ( ( this.removeIncompleteFiles ) ? 'removed files           :' : 'partially written files :' ), this.incompleteFiles.length + '\n' );

        } ).bind( this ),
    
        resetAttributes = ( function(){
            this.chunksReceived = 0;
            this.bytesReceived = 0;
            this.bytesWrittenToDisk = 0;
            this.fileStream = null;
            this.boundString = null;
            this.boundBuffer = null;
            this.uploadRootDir = '';
            this.uploadThreshold = 0;
            this.maxFileSize = 0;
            this.parserOverallTime = 0;
            this.chopped = false;
            this.fileSize = 0;
            this.incompleteFilesCollection = { list: [] };
            this.receivedFilesCollection = { list: [] };
            this.receivedFieldsCollection = { list: [] };
        } ).bind( this ),
        
        sendResponse = ( function( json ){
            logParserStats();
            logOverallResults();
            this.emitEvent( 'loadend', json, 2 );
            resetAttributes();
        } ).bind( this ),
        
        groupResultsByFieldName = ( function( hash ){
            var arr = [];
            for ( var h in hash ){
                arr.push( { name: h, value: hash[ h ] } );
            }
            return arr;
        } ).bind( this ); 
    
    this.endResults = {
        startTime: this.startTime,
        endTime: this.endTime,
        overallSecs: ( this.endTime - this.startTime ) / 1000,
        bytesReceived : this.bytesReceived,
        bytesWrittenToDisk: this.bytesWrittenToDisk,
        chunksReceived : this.chunksReceived,
        filesCompleted: this.completedFiles.length
    };
    ( this.removeIncompleteFiles ) ? this.endResults.removedFiles = this.incompleteFilesCollection.list.length : ( this.endResults.partialFiles = this.incompleteFilesCollection.list.length );
    
    if( this.removeIncompleteFiles === false ){
        sendResponse( { files: groupResultsByFieldName( this.receivedFilesCollection.hash ), incomplete: groupResultsByFieldName( this.incompleteFilesCollection.hash ), fields: this.receivedFieldsCollection.hash, stats: this.endResults } );
    }else{
        if( this.incompleteFilesCollection.list.length === 0 ){
            // incomplete files are already removed, previously it emits exception and fileremoved events 
            sendResponse( { stats: this.endResults, incomplete: [], files: groupResultsByFieldName( this.receivedFilesCollection.hash ), fields: this.receivedFieldsCollection.hash } );
        }else{
          for( var i = 0, ufile = this.incompleteFilesCollection.list, len = ufile.length, currfile = ufile[ 0 ].value.path; i < len; i++, currfile = ( ufile[i] ) ? ( ufile[ i ].value.path  ) : null ){
                fs.unlink( currfile, ( function( err, cfile, i, len ){
                    if( err ){
                        var jsonWarnUnlink = { type: 'warning', isupload: true, msg: '' };
                        jsonWarnUnlink.msg = 'file unlink exception:' + cfile + ', directory: ' + this.uploadRootDir; 
                        this.emitEvent( 'message', jsonWarnUnlink, 1 );
                    }else{
                        var ifile = this.incompleteFilesCollection[ path.basename( cfile ) ],
                            fvalue = ifile.value,
                            jsonFileRemoved = { type: 'fileremoved', isupload: true, msg: 'a file was removed, json: ' };
                            jsonFileRemoved.msg += JSON.stringify({ 
                                name: ifile.name,
                                value: {
                                    name: fvalue.name,
                                    path: cfile,
                                    type: fvalue.type, 
                                    size: fvalue.rbytes,
                                    lastModifiedDate: fvalue.mtime || '',
                                    sha1checksum: 'not calculated'
                                }
                            });
                        this.emitEvent( 'message', jsonFileRemoved, 1 );
                    }
                    if( i === len - 1){
                        // incomplete files are already removed, previously it emits exception and fileremoved events
                        sendResponse( { stats: this.endResults, incomplete: groupResultsByFieldName( this.incompleteFilesCollection.hash ), files: groupResultsByFieldName( this.receivedFilesCollection.hash ), fields: this.receivedFieldsCollection.list } );
                    }
                } ).createDelegate( this, [ currfile, i, len ], true ) );
            } //end for
        }
    }
}; // end sendResponse     


exports.formaline = formaline;
exports.parse = formaline;
