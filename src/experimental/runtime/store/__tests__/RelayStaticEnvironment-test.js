/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

'use strict';

jest
  .autoMockOff();

const Deferred = require('Deferred');
const RelayStaticEnvironment = require('RelayStaticEnvironment');
const RelayInMemoryRecordSource = require('RelayInMemoryRecordSource');
const RelayMarkSweepStore = require('RelayMarkSweepStore');
const RelayNetwork = require('RelayNetwork');
const {ROOT_ID} = require('RelayStoreUtils');
const RelayStaticTestUtils = require('RelayStaticTestUtils');
const {createOperationSelector} = require('RelayStaticOperationSelector');

describe('RelayStaticEnvironment', () => {
  const {generateAndCompile} = RelayStaticTestUtils;
  let config;
  let source;
  let store;

  beforeEach(() => {
    jest.resetModules();
    jasmine.addMatchers(RelayStaticTestUtils.matchers);
    source = new RelayInMemoryRecordSource();
    store = new RelayMarkSweepStore(source);

    config = {
      network: RelayNetwork.create(jest.fn()),
      store,
    };
  });

  describe('getStore()', () => {
    it('returns the store passed to the constructor', () => {
      const environment = new RelayStaticEnvironment(config);
      expect(environment.getStore()).toBe(store);
    });
  });

  describe('lookup()', () => {
    let ParentQuery;
    let environment;

    beforeEach(() => {
      ({ParentQuery} = generateAndCompile(`
        query ParentQuery {
          me {
            id
            name
          }
        }
        fragment ChildFragment on User {
          id
          name
        }
      `));
      environment = new RelayStaticEnvironment(config);
      environment.commitPayload(
        {
          dataID: ROOT_ID,
          node: ParentQuery.query,
          variables: {},
        },
        {
          me: {
            id: '4',
            name: 'Zuck',
          },
        }
      );
    });

    it('returns the results of executing a query', () => {
      const snapshot = environment.lookup({
        dataID: ROOT_ID,
        node: ParentQuery.fragment,
        variables: {},
      });
      expect(snapshot.data).toEqual({
        me: {
          id: '4',
          name: 'Zuck',
        },
      });
    });
  });

  describe('subscribe()', () => {
    let ParentQuery;
    let environment;

    function setName(id, name) {
      environment.applyUpdate(proxy => {
        const user = proxy.get(id);
        user.setValue(name, 'name');
      });
    }

    beforeEach(() => {
      ({ParentQuery} = generateAndCompile(`
        query ParentQuery {
          me {
            id
            name
          }
        }
        fragment ChildFragment on User {
          id
          name
        }
      `));
      environment = new RelayStaticEnvironment(config);
      environment.commitPayload(
        {
          dataID: ROOT_ID,
          node: ParentQuery.query,
          variables: {},
        },
        {
          me: {
            id: '4',
            name: 'Zuck',
          },
        }
      );
    });

    it('calls the callback if data changes', () => {
      const snapshot = environment.lookup({
        dataID: ROOT_ID,
        node: ParentQuery.fragment,
        variables: {},
      });
      const callback = jest.fn();
      environment.subscribe(snapshot, callback);
      setName('4', 'Mark'); // Zuck -> Mark
      expect(callback.mock.calls.length).toBe(1);
      const nextSnapshot = callback.mock.calls[0][0];
      expect(nextSnapshot.data).toEqual({
        me: {
          id: '4',
          name: 'Mark', // reflects updated value
        },
      });
    });

    it('does not call the callback if disposed', () => {
      const snapshot = environment.lookup({
        dataID: ROOT_ID,
        node: ParentQuery.fragment,
        variables: {},
      });
      const callback = jest.fn();
      const {dispose} = environment.subscribe(snapshot, callback);
      dispose();
      setName('4', 'Mark'); // Zuck -> Mark
      expect(callback).not.toBeCalled();
    });
  });

  describe('retain()', () => {
    let ParentQuery;
    let environment;

    beforeEach(() => {
      ({ParentQuery} = generateAndCompile(`
        query ParentQuery {
          me {
            id
            name
          }
        }
        fragment ChildFragment on User {
          id
          name
        }
      `));
      environment = new RelayStaticEnvironment(config);
      environment.commitPayload(
        {
          dataID: ROOT_ID,
          node: ParentQuery.query,
          variables: {},
        },
        {
          me: {
            id: '4',
            name: 'Zuck',
          },
        }
      );
    });

    it('retains data when not disposed', () => {
      environment.retain({
        dataID: ROOT_ID,
        node: ParentQuery.root,
        variables: {},
      });
      const snapshot = environment.lookup({
        dataID: ROOT_ID,
        node: ParentQuery.fragment,
        variables: {},
      });
      // data is still in the store
      expect(snapshot.data).toEqual({
        me: {
          id: '4',
          name: 'Zuck',
        },
      });
    });

    it('releases data when disposed', () => {
      const {dispose} = environment.retain({
        dataID: ROOT_ID,
        node: ParentQuery.root,
        variables: {},
      });
      const selector = {
        dataID: ROOT_ID,
        node: ParentQuery.fragment,
        variables: {},
      };
      dispose();
      // GC runs asynchronously; data should still be in the store
      expect(environment.lookup(selector).data).toEqual({
        me: {
          id: '4',
          name: 'Zuck',
        },
      });
      jest.runAllTimers();
      // After GC runs data is missing
      expect(environment.lookup(selector).data).toBe(undefined);
    });
  });

  describe('applyUpdate()', () => {
    let UserFragment;
    let environment;

    beforeEach(() => {
      ({UserFragment} = generateAndCompile(`
        fragment UserFragment on User {
          id
          name
        }
      `));
      environment = new RelayStaticEnvironment(config);
    });

    it('applies the mutation to the store', () => {
      const selector = {
        dataID: '4',
        node: UserFragment,
        variables: {},
      };
      const callback = jest.fn();
      const snapshot = environment.lookup(selector);
      environment.subscribe(snapshot, callback);

      environment.applyUpdate(proxy => {
        const zuck = proxy.create('4', 'User');
        zuck.setValue('4', 'id');
        zuck.setValue('zuck', 'name');
      });
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual({
        id: '4',
        name: 'zuck',
      });
    });

    it('reverts mutations when disposed', () => {
      const selector = {
        dataID: '4',
        node: UserFragment,
        variables: {},
      };
      const callback = jest.fn();
      const snapshot = environment.lookup(selector);
      environment.subscribe(snapshot, callback);

      const {dispose} = environment.applyUpdate(proxy => {
        const zuck = proxy.create('4', 'User');
        zuck.setValue('zuck', 'name');
      });
      callback.mockClear();
      dispose();
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual(undefined);
    });
  });

  describe('commitPayload()', () => {
    let ActorQuery;
    let environment;

    beforeEach(() => {
      ({ActorQuery} = generateAndCompile(`
        query ActorQuery {
          me {
            name
          }
        }
      `));
      store.notify = jest.fn(store.notify.bind(store));
      store.publish = jest.fn(store.publish.bind(store));
      environment = new RelayStaticEnvironment(config);
    });

    it('applies server updates', () => {
      const selector = {
        dataID: ROOT_ID,
        node: ActorQuery.fragment,
        variables: {},
      };
      const callback = jest.fn();
      const snapshot = environment.lookup(selector);
      environment.subscribe(snapshot, callback);

      environment.commitPayload(
        {
          dataID: ROOT_ID,
          node: ActorQuery.query,
          variables: {},
        },
        {
          me: {
            id: '4',
            __typename: 'User',
            name: 'Zuck',
          },
        }
      );
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual({
        me: {
          name: 'Zuck',
        },
      });
    });

    it('rebases optimistic updates', () => {
      const selector = {
        dataID: ROOT_ID,
        node: ActorQuery.fragment,
        variables: {},
      };
      const callback = jest.fn();
      const snapshot = environment.lookup(selector);
      environment.subscribe(snapshot, callback);

      environment.applyUpdate(proxy => {
        const zuck = proxy.get('4');
        if (zuck) {
          const name = zuck.getValue('name');
          zuck.setValue(name.toUpperCase(), 'name');
        }
      });

      environment.commitPayload(
        {
          dataID: ROOT_ID,
          node: ActorQuery.query,
          variables: {},
        },
        {
          me: {
            id: '4',
            __typename: 'User',
            name: 'Zuck',
          },
        }
      );
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual({
        me: {
          name: 'ZUCK',
        },
      });
    });
  });

  describe('sendQuery()', () => {
    let callbacks;
    let deferred;
    let environment;
    let fetch;
    let onCompleted;
    let onError;
    let onNext;
    let operation;
    let query;
    let variables;

    beforeEach(() => {
      ({ActorQuery: query} = generateAndCompile(`
        query ActorQuery($fetchSize: Boolean!) {
          me {
            name
            profilePicture(size: 42) @include(if: $fetchSize) {
              uri
            }
          }
        }
      `));
      variables = {fetchSize: false};
      operation = createOperationSelector(query, {
        ...variables,
        foo: 'bar', // should be filtered from network fetch
      });

      onCompleted = jest.fn();
      onError = jest.fn();
      onNext = jest.fn();
      callbacks = {onCompleted, onError, onNext};
      deferred = new Deferred();
      fetch = jest.fn(() => deferred.getPromise());
      environment = new RelayStaticEnvironment({
        network: RelayNetwork.create(fetch),
        store,
      });
    });

    it('fetches queries', () => {
      environment.sendQuery({operation});
      expect(fetch.mock.calls.length).toBe(1);
      expect(fetch.mock.calls[0][0]).toBe(query);
      expect(fetch.mock.calls[0][1]).toEqual({fetchSize: false});
      expect(fetch.mock.calls[0][2]).toBe(undefined);
    });

    it('fetches queries with force:true', () => {
      const cacheConfig = {force: true};
      environment.sendQuery({cacheConfig, operation});
      expect(fetch.mock.calls.length).toBe(1);
      expect(fetch.mock.calls[0][0]).toBe(query);
      expect(fetch.mock.calls[0][1]).toEqual({fetchSize: false});
      expect(fetch.mock.calls[0][2]).toBe(cacheConfig);
    });

    it('calls onCompleted() when the batch completes', () => {
      environment.sendQuery({
        ...callbacks,
        operation,
      });
      deferred.resolve({
        data: {
          me: {
            id: '842472',
            __typename: 'User',
            name: 'Joe',
          },
        },
      });
      jest.runAllTimers();
      expect(onCompleted.mock.calls.length).toBe(1);
      expect(onNext.mock.calls.length).toBe(1);
      expect(onError).not.toBeCalled();
    });

    it('calls onError() when the batch has an error', () => {
      environment.sendQuery({
        ...callbacks,
        operation,
      });
      const error = new Error('wtf');
      deferred.reject(error);
      jest.runAllTimers();

      expect(onError).toBeCalled();
      expect(onCompleted).not.toBeCalled();
      expect(onNext.mock.calls.length).toBe(0);
    });

    it('calls onNext() and publishes payloads to the store', () => {
      const selector = {
        dataID: ROOT_ID,
        node: query.fragment,
        variables,
      };
      const snapshot = environment.lookup(selector);
      const callback = jest.fn();
      environment.subscribe(snapshot, callback);

      environment.sendQuery({
        ...callbacks,
        operation,
      });
      const payload = {
        data: {
          me: {
            id: '842472',
            __typename: 'User',
            name: 'Joe',
          },
        },
      };
      deferred.resolve(payload);
      jest.runAllTimers();

      expect(onNext.mock.calls.length).toBe(1);
      expect(onNext).toBeCalledWith({
        errors: undefined,
        fieldPayloads: [],
        source: jasmine.any(Object),
      });
      expect(onCompleted).toBeCalled();
      expect(onError).not.toBeCalled();
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual({
        me: {
          name: 'Joe',
        },
      });
    });
  });

  describe('sendQuerySubscription()', () => {
    let callbacks;
    let environment;
    let fetch;
    let onCompleted;
    let onError;
    let onNext;
    let operation;
    let subject;
    let query;
    let variables;

    beforeEach(() => {
      ({ActorQuery: query} = generateAndCompile(`
        query ActorQuery($fetchSize: Boolean!) {
          me {
            name
            profilePicture(size: 42) @include(if: $fetchSize) {
              uri
            }
          }
        }
      `));
      variables = {fetchSize: false};
      operation = createOperationSelector(query, {
        ...variables,
        foo: 'bar', // should be filtered from network fetch
      });

      onCompleted = jest.fn();
      onError = jest.fn();
      onNext = jest.fn();
      callbacks = {onCompleted, onError, onNext};

      // eslint-disable-next-line no-shadow
      fetch = jest.fn((query, variables, cacheConfig, observer) => {
        let isDisposed = false;
        subject = {
          next(data) {
            if (isDisposed) {
              return;
            }
            // Reuse RelayNetwork's helper for response processing
            RelayNetwork
              .create(() => Promise.resolve(data))
              .request(query, variables, cacheConfig)
              .then(payload => observer.onNext && observer.onNext(payload))
              .catch(error => observer.onError && observer.onError(error));
          },
          complete() {
            if (!isDisposed) {
              observer.onCompleted && onCompleted();
            }
          },
          error(err) {
            if (!isDisposed) {
              observer.onError && observer.onError(err);
            }
          },
        };
        return {
          dispose() {
            isDisposed = true;
          },
        };
      });
      environment = new RelayStaticEnvironment({
        network: {
          request: () => new Deferred(), // not used in this test
          requestSubscription: fetch,
        },
        store,
      });
    });

    it('fetches queries', () => {
      environment.sendQuerySubscription({operation});
      expect(fetch.mock.calls.length).toBe(1);
      expect(fetch.mock.calls[0][0]).toBe(query);
      expect(fetch.mock.calls[0][1]).toEqual({fetchSize: false});
      expect(fetch.mock.calls[0][2]).toBe(undefined);
    });

    it('fetches queries with force:true', () => {
      const cacheConfig = {force: true};
      environment.sendQuerySubscription({cacheConfig, operation});
      expect(fetch.mock.calls.length).toBe(1);
      expect(fetch.mock.calls[0][0]).toBe(query);
      expect(fetch.mock.calls[0][1]).toEqual({fetchSize: false});
      expect(fetch.mock.calls[0][2]).toBe(cacheConfig);
    });

    it('calls onNext() when payloads return', () => {
      environment.sendQuerySubscription({
        ...callbacks,
        operation,
      });
      subject.next({
        data: {
          me: {
            id: '842472',
            __typename: 'User',
            name: 'Joe',
          },
        },
      });
      jest.runAllTimers();
      expect(onNext.mock.calls.length).toBe(1);
      subject.next({
        data: {
          me: {
            id: '842472',
            __typename: 'User',
            name: 'Joseph',
          },
        },
      });
      jest.runAllTimers();
      expect(onNext.mock.calls.length).toBe(2);
      expect(onCompleted).not.toBeCalled();
      expect(onError).not.toBeCalled();
    });

    it('calls onCompleted() when the network request completes', () => {
      environment.sendQuerySubscription({
        ...callbacks,
        operation,
      });
      subject.complete();
      expect(onCompleted.mock.calls.length).toBe(1);
      expect(onError).not.toBeCalled();
      expect(onNext).not.toBeCalled();
    });

    it('calls onError() when the batch has an error', () => {
      environment.sendQuerySubscription({
        ...callbacks,
        operation,
      });
      const error = new Error('wtf');
      subject.error(error);
      jest.runAllTimers();

      expect(onError).toBeCalled();
      expect(onCompleted).not.toBeCalled();
      expect(onNext.mock.calls.length).toBe(0);
    });

    it('calls onNext() and publishes payloads to the store', () => {
      const selector = {
        dataID: ROOT_ID,
        node: query.fragment,
        variables,
      };
      const snapshot = environment.lookup(selector);
      const callback = jest.fn();
      environment.subscribe(snapshot, callback);

      environment.sendQuerySubscription({
        ...callbacks,
        operation,
      });
      const payload = {
        data: {
          me: {
            id: '842472',
            __typename: 'User',
            name: 'Joe',
          },
        },
      };
      subject.next(payload);
      jest.runAllTimers();

      expect(onNext.mock.calls.length).toBe(1);
      expect(onNext).toBeCalledWith({
        errors: undefined,
        fieldPayloads: [],
        source: jasmine.any(Object),
      });
      expect(onCompleted).not.toBeCalled();
      expect(onError).not.toBeCalled();
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual({
        me: {
          name: 'Joe',
        },
      });
    });
  });

  describe('sendMutation()', () => {
    let CreateCommentMutation;
    let CommentFragment;
    let deferred;
    let fetch;
    let environment;
    let onCompleted;
    let onError;
    let operation;
    let variables;

    beforeEach(() => {
      ({
        CreateCommentMutation,
        CommentFragment,
      } = generateAndCompile(`
        mutation CreateCommentMutation($input: CommentCreateInput!) {
          commentCreate(input: $input) {
            comment {
              id
              body {
                text
              }
            }
          }
        }
        fragment CommentFragment on Comment {
          id
          body {
            text
          }
        }
      `));
      variables = {
        input: {
          clientMutationId: '0',
          feedbackId: '1',
        },
      };
      operation = createOperationSelector(CreateCommentMutation, variables);

      deferred = new Deferred();
      fetch = jest.fn(() => deferred.getPromise());
      environment = new RelayStaticEnvironment({
        network: RelayNetwork.create(fetch),
        store,
      });
      onCompleted = jest.fn();
      onError = jest.fn();
    });

    it('fetches the mutation with the provided fetch function', () => {
      environment.sendMutation({
        onCompleted,
        onError,
        operation,
      });
      expect(fetch.mock.calls.length).toBe(1);
      expect(fetch.mock.calls[0][0]).toBe(CreateCommentMutation);
      expect(fetch.mock.calls[0][1]).toEqual(variables);
      expect(fetch.mock.calls[0][2]).toEqual({force: true});
    });

    it('executes the optimistic updater immediately', () => {
      const commentID = 'comment';
      const selector = {
        dataID: commentID,
        node: CommentFragment,
        variables: {},
      };
      const snapshot = environment.lookup(selector);
      const callback = jest.fn();
      environment.subscribe(snapshot, callback);

      environment.sendMutation({
        onCompleted,
        onError,
        operation,
        optimisticUpdater: (proxy) => {
          const comment = proxy.create(commentID, 'Comment');
          comment.setValue(commentID, 'id');
          const body = proxy.create(commentID + '.text', 'Text');
          comment.setLinkedRecord(body, 'body');
          body.setValue('Give Relay', 'text');
        },
      });
      expect(onCompleted).not.toBeCalled();
      expect(onError).not.toBeCalled();
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual({
        id: commentID,
        body: {
          text: 'Give Relay',
        },
      });
    });

    it('reverts the optimistic update if disposed', () => {
      const commentID = 'comment';
      const selector = {
        dataID: commentID,
        node: CommentFragment,
        variables: {},
      };
      const snapshot = environment.lookup(selector);
      const callback = jest.fn();
      environment.subscribe(snapshot, callback);

      const {dispose} = environment.sendMutation({
        onCompleted,
        onError,
        operation,
        optimisticUpdater: (proxy) => {
          const comment = proxy.create(commentID, 'Comment');
          comment.setValue(commentID, 'id');
          const body = proxy.create(commentID + '.text', 'Text');
          comment.setLinkedRecord(body, 'body');
          body.setValue('Give Relay', 'text');
        },
      });
      callback.mockClear();
      dispose();
      expect(onCompleted).not.toBeCalled();
      expect(onError).not.toBeCalled();
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual(undefined);
    });

    it('reverts the optimistic update and commits the server payload', () => {
      const commentID = 'comment';
      const selector = {
        dataID: commentID,
        node: CommentFragment,
        variables: {},
      };
      const snapshot = environment.lookup(selector);
      const callback = jest.fn();
      environment.subscribe(snapshot, callback);

      environment.sendMutation({
        onCompleted,
        onError,
        operation,
        optimisticUpdater: (proxy) => {
          const comment = proxy.create(commentID, 'Comment');
          comment.setValue(commentID, 'id');
          const body = proxy.create(commentID + '.text', 'Text');
          comment.setLinkedRecord(body, 'body');
          body.setValue('Give Relay', 'text');
        },
      });

      callback.mockClear();
      deferred.resolve({
        data: {
          commentCreate: {
            comment: {
              id: commentID,
              body: {
                text: 'Gave Relay',
              },
            },
          },
        },
      });
      jest.runAllTimers();

      expect(onCompleted).toBeCalled();
      expect(onError).not.toBeCalled();
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual({
        id: commentID,
        body: {
          text: 'Gave Relay',
        },
      });
    });

    it('commits the server payload and runs the updater', () => {
      const commentID = 'comment';
      const selector = {
        dataID: commentID,
        node: CommentFragment,
        variables: {},
      };
      const snapshot = environment.lookup(selector);
      const callback = jest.fn();
      environment.subscribe(snapshot, callback);

      environment.sendMutation({
        onCompleted,
        onError,
        operation,
        updater: (proxy) => {
          const comment = proxy.get(commentID);
          const body = comment.getLinkedRecord('body');
          body.setValue(body.getValue('text').toUpperCase(), 'text');
        },
      });

      callback.mockClear();
      deferred.resolve({
        data: {
          commentCreate: {
            comment: {
              id: commentID,
              body: {
                text: 'Gave Relay', // server data is lowercase
              },
            },
          },
        },
      });
      jest.runAllTimers();

      expect(onCompleted).toBeCalled();
      expect(onError).not.toBeCalled();
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual({
        id: commentID,
        body: {
          text: 'GAVE RELAY', // converted to uppercase by updater
        },
      });
    });

    it('reverts the optimistic update if the fetch is rejected', () => {
      const commentID = 'comment';
      const selector = {
        dataID: commentID,
        node: CommentFragment,
        variables: {},
      };
      const snapshot = environment.lookup(selector);
      const callback = jest.fn();
      environment.subscribe(snapshot, callback);

      environment.sendMutation({
        onCompleted,
        onError,
        operation,
        optimisticUpdater: (proxy) => {
          const comment = proxy.create(commentID, 'Comment');
          comment.setValue(commentID, 'id');
          const body = proxy.create(commentID + '.text', 'Text');
          comment.setLinkedRecord(body, 'body');
          body.setValue('Give Relay', 'text');
        },
      });

      callback.mockClear();
      deferred.reject(new Error('wtf'));
      jest.runAllTimers();

      expect(onCompleted).not.toBeCalled();
      expect(onError).toBeCalled();
      expect(callback.mock.calls.length).toBe(1);
      expect(callback.mock.calls[0][0].data).toEqual(undefined);
    });

    it('does not commit the server payload if disposed', () => {
      const commentID = 'comment';
      const selector = {
        dataID: commentID,
        node: CommentFragment,
        variables: {},
      };
      const snapshot = environment.lookup(selector);
      const callback = jest.fn();
      environment.subscribe(snapshot, callback);

      const {dispose} = environment.sendMutation({
        onCompleted,
        onError,
        operation,
        optimisticUpdater: (proxy) => {
          const comment = proxy.create(commentID, 'Comment');
          comment.setValue(commentID, 'id');
          const body = proxy.create(commentID + '.text', 'Text');
          comment.setLinkedRecord(body, 'body');
          body.setValue('Give Relay', 'text');
        },
      });

      dispose();
      callback.mockClear();
      deferred.resolve({
        data: {
          commentCreate: {
            comment: {
              id: commentID,
              body: {
                text: 'Gave Relay',
              },
            },
          },
        },
      });
      jest.runAllTimers();
      expect(onCompleted).not.toBeCalled();
      expect(onError).not.toBeCalled();
      // The optimistic update has already been reverted
      expect(callback.mock.calls.length).toBe(0);
    });
  });
});
